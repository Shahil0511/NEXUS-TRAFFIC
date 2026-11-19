/**
 * Repositories round-trip AS nexus_app (the runtime role, runtime pool options): apps, api keys,
 * audit log, ingest counters, the unnest ingest insert (idempotency), partition maintenance, and the
 * hourly diagnostic counters (rejections, PII detections, SSO outcomes) with their retention.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppRow } from '../../src/domain/rows';
import { isUniqueViolation } from '../../src/db/pg-errors';
import { AdminAuditRepository } from '../../src/repositories/admin-audit.repository';
import { ApiKeyRepository } from '../../src/repositories/api-key.repository';
import { ApiRequestIngestRepository } from '../../src/repositories/api-request-ingest.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { AggregateRetentionRepository } from '../../src/repositories/aggregate-retention.repository';
import { IngestCounterRepository } from '../../src/repositories/ingest-counter.repository';
import { IngestRejectionRepository } from '../../src/repositories/ingest-rejection.repository';
import { PartitionRepository } from '../../src/repositories/partition.repository';
import { PiiDetectionRepository } from '../../src/repositories/pii-detection.repository';
import { SsoCookieOutcomeRepository } from '../../src/repositories/sso-cookie-outcome.repository';
import {
  RUN_DB_TESTS,
  caught,
  createTestDatabase,
  isoDate,
  partitionName,
  utcMonthStart,
  type TestDatabase,
} from './test-database';
import { apiRequestRow, sha256 } from './fixtures';

describe.skipIf(!RUN_DB_TESTS)('repositories as nexus_app (db)', () => {
  let db: TestDatabase;
  let apps: AppRepository;
  let keys: ApiKeyRepository;
  let audit: AdminAuditRepository;
  let counters: IngestCounterRepository;
  let ingest: ApiRequestIngestRepository;
  let partitions: PartitionRepository;
  let app: AppRow;

  beforeAll(async () => {
    db = await createTestDatabase('repos');
    apps = new AppRepository(db.appPool);
    keys = new ApiKeyRepository(db.appPool);
    audit = new AdminAuditRepository(db.appPool);
    counters = new IngestCounterRepository(db.appPool);
    ingest = new ApiRequestIngestRepository(db.appPool);
    partitions = new PartitionRepository(db.appPool);
    app = await apps.insert({
      slug: 'ebo-sales',
      displayName: 'EBO Sales',
      basePath: '/ebo-sales',
      allowedOrigins: ['https://nexus.libas.in'],
      browserIngestEnabled: true,
      createdBy: 'admin@libas.in',
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  // ─── apps ─────────────────────────────────────────────────────────────────

  describe('AppRepository', () => {
    it('inserts with defaults and finds by id / slug / list', async () => {
      expect(app).toMatchObject({
        slug: 'ebo-sales',
        display_name: 'EBO Sales',
        base_path: '/ebo-sales',
        allowed_origins: ['https://nexus.libas.in'],
        is_active: true,
        browser_ingest_enabled: true,
        created_by: 'admin@libas.in',
      });
      expect(app.created_at).toBeInstanceOf(Date);
      expect(await apps.findById(app.id)).toEqual(app);
      expect(await apps.findBySlug('ebo-sales')).toEqual(app);
      expect(await apps.findBySlug('missing-app')).toBeNull();
      await apps.insert({
        slug: 'aa-first',
        displayName: 'First',
        basePath: null,
        allowedOrigins: [],
        browserIngestEnabled: false,
        createdBy: 'admin@libas.in',
      });
      expect((await apps.list()).map((a) => a.slug)).toEqual(['aa-first', 'ebo-sales']);
    });

    it('raises a unique violation for a duplicate slug', async () => {
      const err = await caught(() =>
        apps.insert({
          slug: 'ebo-sales',
          displayName: 'Again',
          basePath: null,
          allowedOrigins: [],
          browserIngestEnabled: true,
          createdBy: 'admin@libas.in',
        }),
      );
      expect(isUniqueViolation(err)).toBe(true);
    });

    it('updates only the provided fields and bumps updated_at', async () => {
      const temp = await apps.insert({
        slug: 'temp-app',
        displayName: 'Temp',
        basePath: '/temp',
        allowedOrigins: ['https://a.example'],
        browserIngestEnabled: true,
        createdBy: 'admin@libas.in',
      });
      const updated = await apps.update(temp.id, { displayName: 'Temp 2', basePath: null, isActive: false });
      expect(updated).toMatchObject({
        display_name: 'Temp 2',
        base_path: null,
        is_active: false,
        allowed_origins: ['https://a.example'],
        browser_ingest_enabled: true,
      });
      expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(temp.updated_at.getTime());
      expect(await apps.update(temp.id, {})).toEqual(updated);
      expect(await apps.update(randomUUID(), { displayName: 'x' })).toBeNull();
    });
  });

  // ─── api keys ─────────────────────────────────────────────────────────────

  describe('ApiKeyRepository', () => {
    const secretPrefix = 'nx_sk_AbCd1234';
    const publicKey = `nx_pk_Zyxw9876${'a'.repeat(24)}`;

    it('inserts secret and publishable keys and finds them by prefix', async () => {
      const secret = await keys.insert({
        appId: app.id,
        kind: 'secret',
        keyPrefix: secretPrefix,
        keyHash: sha256('secret'),
        publicKey: null,
        label: 'backend',
        createdBy: 'admin@libas.in',
      });
      const publishable = await keys.insert({
        appId: app.id,
        kind: 'publishable',
        keyPrefix: publicKey.slice(0, 14),
        keyHash: sha256(publicKey),
        publicKey,
        label: 'browser',
        createdBy: 'admin@libas.in',
      });
      expect(secret).toMatchObject({ kind: 'secret', public_key: null, revoked_at: null, last_used_at: null });
      expect(Buffer.isBuffer(secret.key_hash)).toBe(true);
      expect(secret.key_hash.equals(sha256('secret'))).toBe(true);
      expect(await keys.findByPrefix(secretPrefix)).toEqual(secret);
      expect(await keys.findByPrefix('nx_sk_00000000')).toBeNull();
      const listed = await keys.listByAppIds([app.id]);
      expect(listed.map((k) => k.id).sort()).toEqual([secret.id, publishable.id].sort());
      expect(await keys.listByAppIds([])).toEqual([]);
    });

    it('rejects a key whose prefix does not match its kind', async () => {
      const err = await caught(() =>
        keys.insert({
          appId: app.id,
          kind: 'publishable',
          keyPrefix: 'nx_sk_Mismatch',
          keyHash: sha256('x'),
          publicKey: null,
          label: 'bad',
          createdBy: 'admin@libas.in',
        }),
      );
      expect(err.code).toBe('23514');
    });

    it('sets expiry, revokes idempotently, and refuses to expire a revoked key', async () => {
      const key = (await keys.findByPrefix(secretPrefix))!;
      const expiresAt = new Date(Date.now() + 86_400_000);
      const expiring = await keys.setExpiry(key.id, app.id, expiresAt);
      expect(expiring?.expires_at?.getTime()).toBe(expiresAt.getTime());
      expect(await keys.setExpiry(key.id, randomUUID(), expiresAt)).toBeNull();

      const revoked = await keys.revoke(key.id, app.id, 'first@libas.in');
      const again = await keys.revoke(key.id, app.id, 'second@libas.in');
      expect(revoked?.revoked_by).toBe('first@libas.in');
      expect(again?.revoked_by).toBe('first@libas.in');
      expect(again?.revoked_at?.getTime()).toBe(revoked?.revoked_at?.getTime());
      expect(await keys.setExpiry(key.id, app.id, expiresAt)).toBeNull();
      expect(await keys.revoke(randomUUID(), app.id, 'x@libas.in')).toBeNull();
    });

    it('marks exposure once and throttles usage updates to once a minute', async () => {
      const key = (await keys.findByPrefix(publicKey.slice(0, 14)))!;
      await keys.markExposed(key.id);
      const first = (await keys.findByPrefix(key.key_prefix))!.exposed_at;
      await keys.markExposed(key.id);
      expect((await keys.findByPrefix(key.key_prefix))!.exposed_at).toEqual(first);

      await keys.touchUsage(key.id, '@nexus/react@1.0.0');
      const used = (await keys.findByPrefix(key.key_prefix))!;
      expect(used.last_used_at).toBeInstanceOf(Date);
      expect(used.last_sdk).toBe('@nexus/react@1.0.0');
      await keys.touchUsage(key.id, '@nexus/react@2.0.0');
      const throttled = (await keys.findByPrefix(key.key_prefix))!;
      expect(throttled.last_used_at).toEqual(used.last_used_at);
      expect(throttled.last_sdk).toBe('@nexus/react@1.0.0');

      const { rows: aged } = await db.ownerPool.query<{ last_used_at: Date }>(
        `UPDATE traffic.api_keys SET last_used_at = now() - INTERVAL '2 minutes'
          WHERE id = $1 RETURNING last_used_at`,
        [key.id],
      );
      await keys.touchUsage(key.id, null);
      const later = (await keys.findByPrefix(key.key_prefix))!;
      expect(later.last_used_at!.getTime()).toBeGreaterThan(aged[0]!.last_used_at.getTime() + 60_000);
      expect(later.last_sdk).toBe('@nexus/react@1.0.0');
    });
  });

  // ─── audit + counters ─────────────────────────────────────────────────────

  it('AdminAuditRepository appends entries readable by nexus_app', async () => {
    await audit.record({ actorEmail: 'admin@libas.in', action: 'APP_CREATE', targetType: 'app', targetId: app.id });
    await audit.record({
      actorEmail: 'admin@libas.in',
      action: 'KEY_REVOKE',
      targetType: 'api_key',
      targetId: randomUUID(),
      details: { reason: 'rotation' },
    });
    const { rows } = await db.appPool.query(
      `SELECT action, target_type, details FROM traffic.admin_audit_log ORDER BY id`,
    );
    expect(rows).toEqual([
      { action: 'APP_CREATE', target_type: 'app', details: null },
      { action: 'KEY_REVOKE', target_type: 'api_key', details: { reason: 'rotation' } },
    ]);
  });

  it('IngestCounterRepository sums increments in the IST hour (10:45 IST → 10:00 IST bucket)', async () => {
    const at = new Date('2026-10-01T05:15:00Z'); // 10:45 IST
    const base = { appId: app.id, source: 'server' as const, accepted: 5, duplicates: 1, rejected: 2, rateLimited: 0 };
    await counters.increment(base, at);
    await counters.increment({ ...base, accepted: 3, duplicates: 0, rejected: 0, rateLimited: 4 }, at);
    const { rows } = await db.appPool.query(
      `SELECT bucket_hour, accepted, duplicates, rejected, rate_limited
         FROM traffic.ingest_counters WHERE app_id = $1`,
      [app.id],
    );
    expect(rows).toEqual([
      {
        bucket_hour: new Date('2026-10-01T04:30:00Z'), // 10:00 IST
        accepted: 8,
        duplicates: 1,
        rejected: 2,
        rate_limited: 4,
      },
    ]);
  });

  // ─── ingest ───────────────────────────────────────────────────────────────

  describe('ApiRequestIngestRepository', () => {
    it('inserts a batch, stores every column, and returns [] when the same batch is resent', async () => {
      const rows = [apiRequestRow(app.id), apiRequestRow(app.id, { userEmail: null, userKey: null, identitySource: 'anonymous' })];
      const inserted = await ingest.insertBatch(rows);
      expect(inserted.sort()).toEqual(rows.map((r) => r.eventId).sort());
      expect(await ingest.insertBatch(rows)).toEqual([]);

      const { rows: stored } = await db.appPool.query(
        `SELECT event_id, status_code, duration_ms, user_key, host(ip) AS ip, received_at, geo_lat, sdk
           FROM traffic.api_requests WHERE event_id = $1`,
        [rows[0]!.eventId],
      );
      expect(stored[0]).toMatchObject({ status_code: 200, duration_ms: 12.5, ip: '203.0.113.7', sdk: '@nexus/express@1.0.0' });
      expect(Buffer.from(stored[0].user_key).equals(rows[0]!.userKey!)).toBe(true);
      expect(stored[0].received_at).toBeInstanceOf(Date);
    });

    it('returns only the new ids for a partly-duplicate batch', async () => {
      const first = apiRequestRow(app.id);
      await ingest.insertBatch([first]);
      const second = apiRequestRow(app.id);
      expect(await ingest.insertBatch([first, second])).toEqual([second.eventId]);
    });

    it('returns [] for an empty batch', async () => {
      expect(await ingest.insertBatch([])).toEqual([]);
    });
  });

  // ─── partitions ───────────────────────────────────────────────────────────

  describe('PartitionRepository', () => {
    it('ensures back/current/ahead partitions idempotently and counts future ones', async () => {
      const now = new Date();
      const names = await partitions.ensure(1, 2);
      expect(names).toHaveLength(8);
      expect(names).toContain(partitionName('api_requests', utcMonthStart(now)));
      expect(names).toContain(partitionName('web_events', utcMonthStart(now, 2)));
      expect(await partitions.ensure(1, 2)).toEqual(names);
      expect(await partitions.countFuture('api_requests')).toBe(2);
      expect(await partitions.countFuture('web_events')).toBe(2);
    });

    it('routes an event 6 days old on the 3rd of a month into the previous month', async () => {
      const now = new Date();
      const thirdOfMonth = new Date(utcMonthStart(now).getTime() + 2 * 86_400_000 + 10 * 3_600_000);
      const sixDaysEarlier = new Date(thirdOfMonth.getTime() - 6 * 86_400_000);
      await partitions.ensure(1, 2);
      const row = apiRequestRow(app.id, { occurredAt: sixDaysEarlier });
      expect(await ingest.insertBatch([row])).toEqual([row.eventId]);
      const { rows } = await db.appPool.query<{ partition: string }>(
        `SELECT c.relname AS partition FROM traffic.api_requests r JOIN pg_class c ON c.oid = r.tableoid WHERE r.event_id = $1`,
        [row.eventId],
      );
      expect(rows[0]?.partition).toBe(partitionName('api_requests', utcMonthStart(now, -1)));
    });

    it('drops only partitions older than the retention window', async () => {
      const now = new Date();
      for (let back = 8; back >= 1; back -= 1) {
        await db.ownerPool.query('SELECT traffic.ensure_monthly_partition($1, $2::date)', [
          'api_requests',
          isoDate(utcMonthStart(now, -back)),
        ]);
      }
      const dropped = await partitions.dropExpired('api_requests', 6);
      expect(dropped).toEqual([
        partitionName('api_requests', utcMonthStart(now, -8)),
        partitionName('api_requests', utcMonthStart(now, -7)),
      ]);
      const { rows } = await db.appPool.query<{ name: string }>(
        `SELECT child.relname AS name
           FROM pg_inherits inh
           JOIN pg_class child ON child.oid = inh.inhrelid
          WHERE inh.inhparent = 'traffic.api_requests'::regclass
          ORDER BY 1`,
      );
      const expected = [-6, -5, -4, -3, -2, -1, 0, 1, 2].map((m) => partitionName('api_requests', utcMonthStart(now, m)));
      expect(rows.map((r) => r.name)).toEqual(expected);
      expect(await partitions.dropExpired('api_requests', 6)).toEqual([]);
      expect(await partitions.dropExpired('web_events', 6)).toEqual([]);
    });
  });

  // ─── Diagnostic counters (0010–0012) and their retention ──────────────────

  describe('diagnostic counter repositories', () => {
    const at = new Date('2026-10-01T05:15:00Z'); // 10:45 IST → bucket 10:00 IST
    const bucket = new Date('2026-10-01T04:30:00Z');

    it('IngestRejectionRepository: additive multi-row upsert, duplicate keys in one call are summed', async () => {
      const rejections = new IngestRejectionRepository(db.appPool);
      const row = { source: 'server' as const, sdk: '@nexus/express@1.1.0', code: 'INVALID_EVENT' as const };
      await rejections.increment(
        app.id,
        [
          { ...row, schemaPath: 'status', rejected: 2 },
          { ...row, schemaPath: 'status', rejected: 1 },
          { ...row, schemaPath: '', code: 'INVALID_ENVELOPE', rejected: 1 },
        ],
        at,
      );
      await rejections.increment(app.id, [{ ...row, schemaPath: 'status', rejected: 4 }], at);
      await rejections.increment(app.id, [], at);
      const { rows } = await db.appPool.query(
        `SELECT source, sdk, code, schema_path, bucket_hour, rejected
           FROM traffic.ingest_rejections WHERE app_id = $1 ORDER BY code`,
        [app.id],
      );
      expect(rows).toEqual([
        { ...row, sdk: row.sdk, code: 'INVALID_ENVELOPE', schema_path: '', bucket_hour: bucket, rejected: 1 },
        { ...row, schema_path: 'status', bucket_hour: bucket, rejected: 7 },
      ]);
    });

    it('PiiDetectionRepository: per (source, field, kind, hour)', async () => {
      const pii = new PiiDetectionRepository(db.appPool);
      await pii.increment(
        app.id,
        'browser',
        [
          { field: 'path', kind: 'phone', detections: 2 },
          { field: 'label', kind: 'email', detections: 1 },
        ],
        at,
      );
      await pii.increment(app.id, 'browser', [{ field: 'path', kind: 'phone', detections: 3 }], at);
      const { rows } = await db.appPool.query(
        `SELECT source, field, kind, bucket_hour, detections FROM traffic.pii_detections
          WHERE app_id = $1 ORDER BY field`,
        [app.id],
      );
      expect(rows).toEqual([
        { source: 'browser', field: 'label', kind: 'email', bucket_hour: bucket, detections: 1 },
        { source: 'browser', field: 'path', kind: 'phone', bucket_hour: bucket, detections: 5 },
      ]);
    });

    it('SsoCookieOutcomeRepository: +1 beacon per call', async () => {
      const outcomes = new SsoCookieOutcomeRepository(db.appPool);
      await outcomes.increment(app.id, 'no-cookie', 'cross_origin', at);
      await outcomes.increment(app.id, 'no-cookie', 'cross_origin', at);
      await outcomes.increment(app.id, 'ok', 'same_origin', at);
      const { rows } = await db.appPool.query(
        `SELECT outcome, beacon_origin, bucket_hour, beacons FROM traffic.sso_cookie_outcomes
          WHERE app_id = $1 ORDER BY outcome`,
        [app.id],
      );
      expect(rows).toEqual([
        { outcome: 'no-cookie', beacon_origin: 'cross_origin', bucket_hour: bucket, beacons: 2 },
        { outcome: 'ok', beacon_origin: 'same_origin', bucket_hour: bucket, beacons: 1 },
      ]);
    });

    it('AggregateRetentionRepository deletes rows before the cutoff from all three tables', async () => {
      const old = new Date('2026-06-01T05:15:00Z');
      await new IngestRejectionRepository(db.appPool).increment(
        app.id,
        [{ source: 'browser', sdk: '', code: 'ORIGIN_NOT_ALLOWED', schemaPath: '', rejected: 1 }],
        old,
      );
      await new PiiDetectionRepository(db.appPool).increment(
        app.id,
        'server',
        [{ field: 'release', kind: 'pan', detections: 1 }],
        old,
      );
      await new SsoCookieOutcomeRepository(db.appPool).increment(app.id, 'expired', 'none', old);
      const deleted = await new AggregateRetentionRepository(db.appPool).deleteExpired(
        new Date('2026-09-01T00:00:00Z'),
      );
      expect(deleted).toBe(3);
      for (const table of ['ingest_rejections', 'pii_detections', 'sso_cookie_outcomes']) {
        const { rows } = await db.appPool.query(
          `SELECT count(*)::int AS n FROM traffic.${table} WHERE bucket_hour < '2026-09-01'`,
        );
        expect(rows[0]?.n).toBe(0);
      }
    });
  });

  it('ApiRequestIngestRepository stores the environment column (0007)', async () => {
    const row = apiRequestRow(app.id, { environment: 'staging' });
    expect(await ingest.insertBatch([row])).toEqual([row.eventId]);
    const { rows } = await db.appPool.query(`SELECT environment FROM traffic.api_requests WHERE event_id = $1`, [
      row.eventId,
    ]);
    expect(rows[0]).toEqual({ environment: 'staging' });
  });
});
