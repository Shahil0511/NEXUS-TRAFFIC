import { ERROR_CODES } from '@nexus/shared';
import type { KeyKind } from '@nexus/shared';
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiKeyRow, APP_ID, appRow, KEY_ID } from '../../test/fixtures/app-rows';
import type { ApiKeyGenerator, GeneratedApiKey } from '../auth/api-key.generator';
import type { AppKeyCache } from '../auth/app-key.cache';
import type { Executor } from '../db/executor';
import type { AppPatch, AuditEntry, NewApiKey, NewApp } from '../domain/inserts';
import type { ApiKeyRow, AppRow } from '../domain/rows';
import type { Viewer } from '../domain/viewer';
import { AppError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { AdminAuditRepository } from '../repositories/admin-audit.repository';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';
import { AppAdminService } from './app-admin.service';

// ─── Fakes ────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-01T10:00:00.000Z');
const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };

/** Ordered log of everything that happened: SQL control statements, repo calls, cache calls. */
type Log = string[];

function fakePool(log: Log): { pool: Pool; client: PoolClient } {
  const client = {
    query: async (sql: string) => {
      log.push(sql);
      return { rows: [] };
    },
    release: () => log.push('release'),
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, client };
}

class FakeApps implements Pick<AppRepository, 'findBySlug' | 'insert' | 'update'> {
  rows: AppRow[] = [appRow()];
  failInsertWith: unknown = null;
  readonly execs: Executor[] = [];
  lastPatch: AppPatch | null = null;
  constructor(private readonly log: Log) {}

  async findBySlug(slug: string, exec?: Executor): Promise<AppRow | null> {
    this.execs.push(exec as Executor);
    return this.rows.find((row) => row.slug === slug) ?? null;
  }

  async insert(app: NewApp, exec?: Executor): Promise<AppRow> {
    this.execs.push(exec as Executor);
    this.log.push('apps.insert');
    if (this.failInsertWith) throw this.failInsertWith;
    return appRow({
      slug: app.slug,
      display_name: app.displayName,
      base_path: app.basePath,
      allowed_origins: app.allowedOrigins,
      browser_ingest_enabled: app.browserIngestEnabled,
      created_by: app.createdBy,
    });
  }

  async update(id: string, patch: AppPatch, exec?: Executor): Promise<AppRow | null> {
    this.execs.push(exec as Executor);
    this.log.push('apps.update');
    this.lastPatch = patch;
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row, is_active: patch.isActive ?? row.is_active } : null;
  }
}

class FakeKeys implements Pick<
  ApiKeyRepository,
  'listByAppIds' | 'insert' | 'setExpiry' | 'revoke'
> {
  rows: ApiKeyRow[] = [apiKeyRow()];
  readonly execs: Executor[] = [];
  lastInsert: NewApiKey | null = null;
  lastExpiry: Date | null = null;
  lastRevokedBy: string | null = null;
  constructor(private readonly log: Log) {}

  async listByAppIds(appIds: string[], exec?: Executor): Promise<ApiKeyRow[]> {
    this.execs.push(exec as Executor);
    return this.rows.filter((row) => appIds.includes(row.app_id));
  }

  async insert(key: NewApiKey, exec?: Executor): Promise<ApiKeyRow> {
    this.execs.push(exec as Executor);
    this.log.push('keys.insert');
    this.lastInsert = key;
    return apiKeyRow({
      id: 'new-key',
      app_id: key.appId,
      kind: key.kind,
      key_prefix: key.keyPrefix,
      key_hash: key.keyHash,
      public_key: key.publicKey,
      label: key.label,
      created_by: key.createdBy,
    });
  }

  async setExpiry(
    id: string,
    appId: string,
    expiresAt: Date,
    exec?: Executor,
  ): Promise<ApiKeyRow | null> {
    this.execs.push(exec as Executor);
    this.log.push('keys.setExpiry');
    this.lastExpiry = expiresAt;
    const row = this.rows.find((r) => r.id === id && r.app_id === appId && !r.revoked_at);
    return row ? { ...row, expires_at: expiresAt } : null;
  }

  async revoke(
    id: string,
    appId: string,
    revokedBy: string,
    exec?: Executor,
  ): Promise<ApiKeyRow | null> {
    this.execs.push(exec as Executor);
    this.log.push('keys.revoke');
    this.lastRevokedBy = revokedBy;
    const row = this.rows.find((r) => r.id === id && r.app_id === appId);
    return row ? { ...row, revoked_at: NOW, revoked_by: revokedBy } : null;
  }
}

class FakeAudit implements Pick<AdminAuditRepository, 'record'> {
  readonly entries: AuditEntry[] = [];
  readonly execs: Executor[] = [];
  fail = false;
  constructor(private readonly log: Log) {}

  async record(entry: AuditEntry, exec?: Executor): Promise<void> {
    this.execs.push(exec as Executor);
    this.log.push(`audit.${entry.action}`);
    if (this.fail) throw new Error('audit insert failed');
    this.entries.push(entry);
  }
}

class FakeGenerator implements Pick<ApiKeyGenerator, 'generate'> {
  generate(kind: KeyKind): GeneratedApiKey {
    const plaintext = kind === 'secret' ? `nx_sk_${'S'.repeat(40)}` : `nx_pk_${'P'.repeat(32)}`;
    return {
      kind,
      plaintext,
      keyPrefix: plaintext.slice(0, 14),
      keyHash: Buffer.alloc(32, 1),
      publicKey: kind === 'publishable' ? plaintext : null,
    };
  }
}

class FakeCache implements Pick<AppKeyCache, 'invalidateApp'> {
  constructor(private readonly log: Log) {}
  invalidateApp(appId: string): void {
    this.log.push(`invalidate:${appId}`);
  }
}

function build() {
  const log: Log = [];
  const { pool, client } = fakePool(log);
  const apps = new FakeApps(log);
  const keys = new FakeKeys(log);
  const audit = new FakeAudit(log);
  const service = new AppAdminService(
    pool,
    apps as unknown as AppRepository,
    keys as unknown as ApiKeyRepository,
    audit as unknown as AdminAuditRepository,
    new FakeGenerator() as unknown as ApiKeyGenerator,
    new FakeCache(log) as unknown as AppKeyCache,
    new FixedClock(NOW),
  );
  return { log, client, apps, keys, audit, service };
}

async function expectAppError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  expect((err as AppError).code).toBe(code);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppAdminService', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build();
  });

  describe('create', () => {
    const body = {
      slug: 'new-app',
      displayName: 'New App',
      basePath: null,
      allowedOrigins: [],
      browserIngestEnabled: true,
    };

    it('inserts and audits inside one transaction, passing the client to every repository', async () => {
      const dto = await t.service.create(body, ADMIN);

      expect(t.log).toEqual(['BEGIN', 'apps.insert', 'audit.APP_CREATE', 'COMMIT', 'release']);
      expect(t.apps.execs).toEqual([t.client]);
      expect(t.audit.execs).toEqual([t.client]);
      expect(t.audit.entries[0]).toEqual({
        actorEmail: ADMIN.email,
        action: 'APP_CREATE',
        targetType: 'app',
        targetId: APP_ID,
        details: { slug: 'new-app' },
      });
      expect(dto).toMatchObject({ slug: 'new-app', displayName: 'New App', keys: [] });
    });

    it('maps a unique violation to 409 CONFLICT after rolling back', async () => {
      t.apps.failInsertWith = Object.assign(new Error('duplicate key'), { code: '23505' });
      await expectAppError(t.service.create(body, ADMIN), 409, ERROR_CODES.CONFLICT);
      expect(t.log).toEqual(['BEGIN', 'apps.insert', 'ROLLBACK', 'release']);
    });

    it('rethrows other errors unchanged', async () => {
      const boom = new Error('boom');
      t.apps.failInsertWith = boom;
      await expect(t.service.create(body, ADMIN)).rejects.toBe(boom);
    });
  });

  describe('update', () => {
    it('patches only the sent fields, audits APP_UPDATE and returns the app with its keys', async () => {
      const dto = await t.service.update('ebo-sales', { displayName: 'Renamed' }, ADMIN);

      expect(t.apps.lastPatch).toEqual({ displayName: 'Renamed' });
      expect(t.audit.entries[0]).toMatchObject({
        action: 'APP_UPDATE',
        targetType: 'app',
        targetId: APP_ID,
      });
      expect(t.log).toEqual([
        'BEGIN',
        'apps.update',
        'audit.APP_UPDATE',
        'COMMIT',
        'release',
        `invalidate:${APP_ID}`,
      ]);
      expect(dto.keys.map((k) => k.id)).toEqual([KEY_ID]);
      expect(t.keys.execs).toEqual([t.client]);
    });

    it('audits APP_DISABLE when isActive becomes false', async () => {
      const dto = await t.service.update('ebo-sales', { isActive: false }, ADMIN);
      expect(t.audit.entries[0]?.action).toBe('APP_DISABLE');
      expect(dto.isActive).toBe(false);
    });

    it('404s an unknown slug without touching the cache', async () => {
      await expectAppError(
        t.service.update('nope', { displayName: 'x' }, ADMIN),
        404,
        ERROR_CODES.NOT_FOUND,
      );
      expect(t.log).toEqual(['BEGIN', 'ROLLBACK', 'release']);
    });

    it('rolls back and does NOT invalidate the cache when the audit insert fails', async () => {
      t.audit.fail = true;
      await expect(t.service.update('ebo-sales', { isActive: false }, ADMIN)).rejects.toThrow(
        'audit insert failed',
      );
      expect(t.log).toEqual(['BEGIN', 'apps.update', 'audit.APP_DISABLE', 'ROLLBACK', 'release']);
    });
  });

  describe('createKey', () => {
    it('stores only the hash, returns the plaintext once, audits without the secret', async () => {
      const result = await t.service.createKey(
        'ebo-sales',
        { kind: 'secret', label: 'prod' },
        ADMIN,
      );

      expect(result.plaintextKey).toBe(`nx_sk_${'S'.repeat(40)}`);
      expect(t.keys.lastInsert).toEqual({
        appId: APP_ID,
        kind: 'secret',
        keyPrefix: 'nx_sk_SSSSSSSS',
        keyHash: Buffer.alloc(32, 1),
        publicKey: null,
        label: 'prod',
        createdBy: ADMIN.email,
      });
      expect(result.key).toMatchObject({
        id: 'new-key',
        kind: 'secret',
        keyPrefix: 'nx_sk_SSSSSSSS',
      });
      expect(result.key).not.toHaveProperty('keyHash');
      expect(t.audit.entries[0]).toEqual({
        actorEmail: ADMIN.email,
        action: 'KEY_CREATE',
        targetType: 'api_key',
        targetId: 'new-key',
        details: { kind: 'secret', keyPrefix: 'nx_sk_SSSSSSSS', label: 'prod' },
      });
      expect(JSON.stringify(t.audit.entries)).not.toContain(result.plaintextKey);
      expect(t.log).toEqual([
        'BEGIN',
        'keys.insert',
        'audit.KEY_CREATE',
        'COMMIT',
        'release',
        `invalidate:${APP_ID}`,
      ]);
    });

    it('stores the publishable key in clear', async () => {
      const result = await t.service.createKey(
        'ebo-sales',
        { kind: 'publishable', label: 'web' },
        ADMIN,
      );
      expect(t.keys.lastInsert?.publicKey).toBe(result.plaintextKey);
      expect(result.key.publicKey).toBe(result.plaintextKey);
    });

    it('404s an unknown app', async () => {
      await expectAppError(
        t.service.createKey('nope', { kind: 'secret', label: 'x' }, ADMIN),
        404,
        ERROR_CODES.NOT_FOUND,
      );
      expect(t.log).not.toContain('keys.insert');
    });
  });

  describe('expireKey', () => {
    const future = '2026-10-08T10:00:00.000Z';

    it('sets a future expiry, audits KEY_EXPIRE and invalidates after commit', async () => {
      const dto = await t.service.expireKey('ebo-sales', KEY_ID, { expiresAt: future }, ADMIN);

      expect(t.keys.lastExpiry?.toISOString()).toBe(future);
      expect(dto.expiresAt).toBe(future);
      expect(t.audit.entries[0]).toMatchObject({
        action: 'KEY_EXPIRE',
        targetType: 'api_key',
        targetId: KEY_ID,
        details: {
          kind: 'secret',
          keyPrefix: 'nx_sk_AbCdEfGh',
          label: 'production',
          expiresAt: future,
        },
      });
      expect(t.log).toEqual([
        'BEGIN',
        'keys.setExpiry',
        'audit.KEY_EXPIRE',
        'COMMIT',
        'release',
        `invalidate:${APP_ID}`,
      ]);
    });

    it('rejects a past or present expiry with 400 VALIDATION_ERROR before any DB work', async () => {
      await expectAppError(
        t.service.expireKey('ebo-sales', KEY_ID, { expiresAt: NOW.toISOString() }, ADMIN),
        400,
        ERROR_CODES.VALIDATION_ERROR,
      );
      expect(t.log).toEqual([]);
    });

    it('404s an unknown or revoked key', async () => {
      t.keys.rows = [apiKeyRow({ revoked_at: NOW })];
      await expectAppError(
        t.service.expireKey('ebo-sales', KEY_ID, { expiresAt: future }, ADMIN),
        404,
        ERROR_CODES.NOT_FOUND,
      );
      expect(t.log).toEqual(['BEGIN', 'keys.setExpiry', 'ROLLBACK', 'release']);
    });
  });

  describe('revokeKey', () => {
    it('revokes as the actor, audits KEY_REVOKE and invalidates after commit', async () => {
      const dto = await t.service.revokeKey('ebo-sales', KEY_ID, ADMIN);

      expect(t.keys.lastRevokedBy).toBe(ADMIN.email);
      expect(dto.revokedAt).toBe(NOW.toISOString());
      expect(t.audit.entries[0]).toMatchObject({ action: 'KEY_REVOKE', targetId: KEY_ID });
      expect(t.keys.execs).toEqual([t.client]);
      expect(t.log).toEqual([
        'BEGIN',
        'keys.revoke',
        'audit.KEY_REVOKE',
        'COMMIT',
        'release',
        `invalidate:${APP_ID}`,
      ]);
    });

    it('404s a key of another app', async () => {
      t.keys.rows = [apiKeyRow({ app_id: 'other-app' })];
      await expectAppError(
        t.service.revokeKey('ebo-sales', KEY_ID, ADMIN),
        404,
        ERROR_CODES.NOT_FOUND,
      );
      expect(t.log).not.toContain(`invalidate:${APP_ID}`);
    });
  });
});
