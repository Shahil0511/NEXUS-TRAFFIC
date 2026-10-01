/**
 * Write side of app management (admins only). Every mutation runs in a transaction with its
 * audit row, then invalidates the key cache so revocations take effect on the next request.
 */
import type {
  ApiKeyDto,
  AppCreatedDto,
  AppDto,
  CreateAppBody,
  CreateKeyBody,
  ExpireKeyBody,
  KeyCreatedDto,
  UpdateAppBody,
} from '@nexus/shared';
import type { Pool, PoolClient } from 'pg';

import type { ApiKeyGenerator } from '../auth/api-key.generator';
import type { AppKeyCache } from '../auth/app-key.cache';
import { isUniqueViolation } from '../db/pg-errors';
import { withTransaction } from '../db/transaction';
import type { AppPatch, AuditEntry } from '../domain/inserts';
import { mapApiKey, mapApp } from '../domain/mappers';
import type { ApiKeyRow, AppRow } from '../domain/rows';
import type { Viewer } from '../domain/viewer';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { AdminAuditRepository } from '../repositories/admin-audit.repository';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** WHY: copy ONLY the fields the admin sent, so the repository updates nothing else. */
function toAppPatch(body: UpdateAppBody): AppPatch {
  const patch: AppPatch = {};
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.basePath !== undefined) patch.basePath = body.basePath;
  if (body.allowedOrigins !== undefined) patch.allowedOrigins = body.allowedOrigins;
  if (body.browserIngestEnabled !== undefined)
    patch.browserIngestEnabled = body.browserIngestEnabled;
  if (body.isActive !== undefined) patch.isActive = body.isActive;
  return patch;
}

/** WHY: audit details for a key — enough to identify it, NEVER the secret or its hash. */
function keyAuditDetails(key: ApiKeyRow): Record<string, unknown> {
  return { kind: key.kind, keyPrefix: key.key_prefix, label: key.label };
}

/** WHY: one wording for "no such app" across every admin route. */
function appNotFound(slug: string): NotFoundError {
  return new NotFoundError(`App "${slug}" not found`);
}

/** WHY: one wording for "no such key of that app" (also covers revoked keys on expire). */
function keyNotFound(slug: string, keyId: string): NotFoundError {
  return new NotFoundError(`Key "${keyId}" of app "${slug}" not found`);
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * WHY: ROUTES.apps.create/update/createKey/expireKey/revokeKey. Keeping the audit row in the SAME
 * transaction as the change means there is never a change without its audit trail (or vice versa).
 * @see ../repositories/app.repository.ts
 * @see ../repositories/api-key.repository.ts
 * @see ../repositories/admin-audit.repository.ts
 * @see ../../migrations/0002_apps_and_api_keys.sql
 * @see ../../migrations/0003_admin_audit_log.sql
 */
export class AppAdminService {
  constructor(
    private readonly db: Pool,
    private readonly apps: AppRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly audit: AdminAuditRepository,
    private readonly generator: ApiKeyGenerator,
    private readonly keyCache: AppKeyCache,
    private readonly clock: Clock,
  ) {}

  /**
   * 409 when the slug exists. Audit: APP_CREATE. No cache invalidation: a new app has no keys.
   * @see ../repositories/app.repository.ts AppRepository.insert
   */
  async create(body: CreateAppBody, actor: Viewer): Promise<AppCreatedDto> {
    try {
      const row = await withTransaction(this.db, async (client) => {
        const app = await this.apps.insert({ ...body, createdBy: actor.email }, client);
        await this.record(client, actor, 'APP_CREATE', 'app', app.id, { slug: app.slug });
        return app;
      });
      return mapApp(row, []);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(`App "${body.slug}" already exists`);
      throw err;
    }
  }

  /**
   * 404 unknown slug. Audit: APP_UPDATE (or APP_DISABLE when isActive becomes false).
   * @see ../repositories/app.repository.ts AppRepository.update
   */
  async update(slug: string, body: UpdateAppBody, actor: Viewer): Promise<AppDto> {
    const patch = toAppPatch(body);
    const action = body.isActive === false ? 'APP_DISABLE' : 'APP_UPDATE';
    const result = await withTransaction(this.db, async (client) => {
      const app = await this.requireApp(slug, client);
      const updated = await this.apps.update(app.id, patch, client);
      if (!updated) throw appNotFound(slug);
      await this.record(client, actor, action, 'app', updated.id, {
        slug,
        fields: Object.keys(patch),
      });
      const keys = await this.apiKeys.listByAppIds([updated.id], client);
      return { app: updated, keys };
    });
    this.keyCache.invalidateApp(result.app.id);
    return mapApp(result.app, result.keys);
  }

  /**
   * Returns the plaintext key ONCE. Audit: KEY_CREATE.
   * @see ../repositories/api-key.repository.ts ApiKeyRepository.insert
   */
  async createKey(slug: string, body: CreateKeyBody, actor: Viewer): Promise<KeyCreatedDto> {
    const generated = this.generator.generate(body.kind);
    const row = await withTransaction(this.db, async (client) => {
      const app = await this.requireApp(slug, client);
      const key = await this.apiKeys.insert(
        {
          appId: app.id,
          kind: generated.kind,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          publicKey: generated.publicKey,
          label: body.label,
          createdBy: actor.email,
        },
        client,
      );
      await this.record(client, actor, 'KEY_CREATE', 'api_key', key.id, keyAuditDetails(key));
      return key;
    });
    this.keyCache.invalidateApp(row.app_id);
    return { key: mapApiKey(row), plaintextKey: generated.plaintext };
  }

  /**
   * Rotation grace: set expires_at (must be in the future). Audit: KEY_EXPIRE.
   * @see ../repositories/api-key.repository.ts ApiKeyRepository.setExpiry
   */
  async expireKey(
    slug: string,
    keyId: string,
    body: ExpireKeyBody,
    actor: Viewer,
  ): Promise<ApiKeyDto> {
    const expiresAt = this.requireFuture(body.expiresAt);
    const row = await withTransaction(this.db, async (client) => {
      const app = await this.requireApp(slug, client);
      const key = await this.apiKeys.setExpiry(keyId, app.id, expiresAt, client);
      if (!key) throw keyNotFound(slug, keyId);
      const details = { ...keyAuditDetails(key), expiresAt: expiresAt.toISOString() };
      await this.record(client, actor, 'KEY_EXPIRE', 'api_key', key.id, details);
      return key;
    });
    this.keyCache.invalidateApp(row.app_id);
    return mapApiKey(row);
  }

  /**
   * Immediate revocation. Audit: KEY_REVOKE.
   * @see ../repositories/api-key.repository.ts ApiKeyRepository.revoke
   */
  async revokeKey(slug: string, keyId: string, actor: Viewer): Promise<ApiKeyDto> {
    const row = await withTransaction(this.db, async (client) => {
      const app = await this.requireApp(slug, client);
      const key = await this.apiKeys.revoke(keyId, app.id, actor.email, client);
      if (!key) throw keyNotFound(slug, keyId);
      await this.record(client, actor, 'KEY_REVOKE', 'api_key', key.id, keyAuditDetails(key));
      return key;
    });
    this.keyCache.invalidateApp(row.app_id);
    return mapApiKey(row);
  }

  // ─── Steps ──────────────────────────────────────────────────────────────────

  /** @see ../repositories/app.repository.ts AppRepository.findBySlug */
  private async requireApp(slug: string, client: PoolClient): Promise<AppRow> {
    const app = await this.apps.findBySlug(slug, client);
    if (!app) throw appNotFound(slug);
    return app;
  }

  /** An expiry in the past would be a revocation in disguise — that is revokeKey's job. */
  private requireFuture(iso: string): Date {
    const expiresAt = new Date(iso);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new ValidationError('expiresAt must be in the future', [
        { path: 'expiresAt', message: 'must be in the future' },
      ]);
    }
    return expiresAt;
  }

  /** @see ../repositories/admin-audit.repository.ts AdminAuditRepository.record */
  private async record(
    client: PoolClient,
    actor: Viewer,
    action: AuditEntry['action'],
    targetType: AuditEntry['targetType'],
    targetId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      { actorEmail: actor.email, action, targetType, targetId, details },
      client,
    );
  }
}
