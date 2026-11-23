/**
 * The runtime role's boundaries (ADR 0001 "Roles"): nexus_app has DML only — no DDL, no TRUNCATE,
 * an append-only audit log, partition DDL ONLY through the whitelisted SECURITY DEFINER functions —
 * plus the pg error classification the ingest service relies on (src/db/pg-errors.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadMigrations } from '../../src/db/migration-runner/loader';
import { isDataError, isMissingPartition } from '../../src/db/pg-errors';
import { MIGRATIONS_DIR } from '../../src/db/schema';
import type { AppRow } from '../../src/domain/rows';
import { AdminAuditRepository } from '../../src/repositories/admin-audit.repository';
import { ApiRequestIngestRepository } from '../../src/repositories/api-request-ingest.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { PartitionRepository } from '../../src/repositories/partition.repository';
import { PersonAccessLogRepository } from '../../src/repositories/person-access-log.repository';
import { apiRequestRow } from './fixtures';
import { RUN_DB_TESTS, caught, createTestDatabase, partitionName, type TestDatabase } from './test-database';

const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER_VALUE = '22023';

describe.skipIf(!RUN_DB_TESTS)('nexus_app privileges and error classification (db)', () => {
  let db: TestDatabase;
  let app: AppRow;
  let ingest: ApiRequestIngestRepository;

  beforeAll(async () => {
    db = await createTestDatabase('privileges');
    app = await new AppRepository(db.appPool).insert({
      slug: 'priv-app',
      displayName: 'Privileges',
      basePath: null,
      allowedOrigins: [],
      browserIngestEnabled: true,
      createdBy: 'admin@libas.in',
    });
    await new AdminAuditRepository(db.appPool).record({
      actorEmail: 'admin@libas.in',
      action: 'APP_CREATE',
      targetType: 'app',
      targetId: app.id,
    });
    ingest = new ApiRequestIngestRepository(db.appPool);
  });

  afterAll(async () => {
    await db?.drop();
  });

  // ─── DDL and append-only rules ────────────────────────────────────────────

  it.each([
    ['DROP TABLE', 'DROP TABLE traffic.apps'],
    ['ALTER TABLE', 'ALTER TABLE traffic.apps ADD COLUMN evil int'],
    ['CREATE TABLE', 'CREATE TABLE traffic.evil (id int)'],
    ['TRUNCATE', 'TRUNCATE traffic.api_requests'],
    ['UPDATE audit log', `UPDATE traffic.admin_audit_log SET actor_email = 'x@libas.in'`],
    ['DELETE audit log', 'DELETE FROM traffic.admin_audit_log'],
    ['UPDATE access log', `UPDATE traffic.person_access_log SET viewer_email = 'x@libas.in'`],
    ['DELETE access log', 'DELETE FROM traffic.person_access_log'],
    ['TRUNCATE access log', 'TRUNCATE traffic.person_access_log'],
    ['write the ledger', `DELETE FROM traffic.schema_migrations`],
    ['DROP FUNCTION', 'DROP FUNCTION traffic.ensure_partitions(int, int)'],
  ])('nexus_app cannot %s', async (_label, sql) => {
    expect((await caught(() => db.appPool.query(sql))).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('nexus_app can read the audit log and the ledger', async () => {
    const audit = await db.appPool.query('SELECT count(*)::int AS n FROM traffic.admin_audit_log');
    const ledger = await db.appPool.query('SELECT count(*)::int AS n FROM traffic.schema_migrations');
    expect(audit.rows[0].n).toBe(1);
    expect(ledger.rows[0].n).toBe((await loadMigrations(MIGRATIONS_DIR)).length);
  });

  it('nexus_app can append to and read the person access log (0013, listed in grants.ts)', async () => {
    await new PersonAccessLogRepository(db.appPool).record({
      viewerEmail: 'admin@libas.in',
      subjectUserKey: Buffer.alloc(32, 7),
      subjectEmailMasked: 's***@libas.in',
      surface: 'person_profile',
    });
    const { rows } = await db.appPool.query('SELECT count(*)::int AS n FROM traffic.person_access_log');
    expect(rows[0].n).toBe(1);
  });

  // ─── the diagnostic aggregates (0010–0012): listed explicitly in grants.ts ─

  it.each([
    [
      'ingest_rejections',
      `INSERT INTO traffic.ingest_rejections (app_id, source, sdk, code, schema_path, bucket_hour, rejected)
       VALUES ($1, 'browser', '', 'INVALID_EVENT', 'events.*.path', $2, 1)
       ON CONFLICT (app_id, source, sdk, code, schema_path, bucket_hour)
       DO UPDATE SET rejected = traffic.ingest_rejections.rejected + EXCLUDED.rejected`,
      `SELECT rejected AS n FROM traffic.ingest_rejections WHERE app_id = $1`,
    ],
    [
      'pii_detections',
      `INSERT INTO traffic.pii_detections (app_id, source, field, kind, bucket_hour, detections)
       VALUES ($1, 'server', 'path', 'email', $2, 1)
       ON CONFLICT (app_id, source, field, kind, bucket_hour)
       DO UPDATE SET detections = traffic.pii_detections.detections + EXCLUDED.detections`,
      `SELECT detections AS n FROM traffic.pii_detections WHERE app_id = $1`,
    ],
    [
      'sso_cookie_outcomes',
      `INSERT INTO traffic.sso_cookie_outcomes (app_id, outcome, beacon_origin, bucket_hour, beacons)
       VALUES ($1, 'no-cookie', 'cross_origin', $2, 1)
       ON CONFLICT (app_id, outcome, beacon_origin, bucket_hour)
       DO UPDATE SET beacons = traffic.sso_cookie_outcomes.beacons + EXCLUDED.beacons`,
      `SELECT beacons AS n FROM traffic.sso_cookie_outcomes WHERE app_id = $1`,
    ],
  ])('nexus_app can upsert into and prune %s', async (table, upsert, read) => {
    const hour = new Date('2026-10-01T04:30:00Z');
    await db.appPool.query(upsert, [app.id, hour]);
    await db.appPool.query(upsert, [app.id, hour]);
    const { rows } = await db.appPool.query<{ n: number }>(read, [app.id]);
    expect(rows).toEqual([{ n: 2 }]);
    await db.appPool.query(`DELETE FROM traffic.${table} WHERE app_id = $1`, [app.id]);
  });

  // ─── partitions created later by the SECURITY DEFINER function ────────────

  it('can create a partition only via the function, write through the parent, but not drop it', async () => {
    const month = new Date(Date.UTC(2031, 4, 1));
    const { rows } = await db.appPool.query<{ name: string }>(
      'SELECT traffic.ensure_monthly_partition($1, $2::date) AS name',
      ['api_requests', '2031-05-17'],
    );
    const name = partitionName('api_requests', month);
    expect(rows[0]?.name).toBe(name);

    const row = apiRequestRow(app.id, { occurredAt: new Date('2031-05-20T08:00:00Z') });
    expect(await ingest.insertBatch([row])).toEqual([row.eventId]);
    const direct = await db.appPool.query(`SELECT count(*)::int AS n FROM traffic.${name}`);
    expect(direct.rows[0].n).toBe(1);

    const owner = await db.ownerPool.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = $1::regclass`,
      [`traffic.${name}`],
    );
    expect(owner.rows[0]?.owner).not.toBe('nexus_app');
    expect((await caught(() => db.appPool.query(`DROP TABLE traffic.${name}`))).code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('the partition functions reject non-whitelisted tables and bad arguments', async () => {
    const partitions = new PartitionRepository(db.appPool);
    const notManaged = await caught(() =>
      db.appPool.query(`SELECT traffic.ensure_monthly_partition('apps', DATE '2030-01-01')`),
    );
    expect(notManaged.code).toBe(INVALID_PARAMETER_VALUE);
    const dropApps = await caught(() =>
      db.appPool.query(`SELECT * FROM traffic.drop_expired_partitions('apps', 6)`),
    );
    expect(dropApps.code).toBe(INVALID_PARAMETER_VALUE);
    expect((await caught(() => partitions.dropExpired('api_requests', 0))).code).toBe(INVALID_PARAMETER_VALUE);
    expect((await caught(() => partitions.ensure(-1, 2))).code).toBe(INVALID_PARAMETER_VALUE);
  });

  it('the partition functions are not executable by PUBLIC', async () => {
    const { rows } = await db.ownerPool.query<{ fn: string; public_exec: boolean }>(
      `SELECT p.proname AS fn,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p
        WHERE p.pronamespace = 'traffic'::regnamespace
          AND p.proname IN ('ensure_monthly_partition', 'ensure_partitions', 'drop_expired_partitions')`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.public_exec)).toBe(true);
  });

  // ─── error classification (pg-errors.ts) ──────────────────────────────────

  it('a CHECK violation is a data error, not a missing partition', async () => {
    const err = await caught(() => ingest.insertBatch([apiRequestRow(app.id, { path: 'javascript:alert(1)' })]));
    expect(err.code).toBe('23514');
    expect(err.constraint).toBe('api_requests_path_check');
    expect(isDataError(err)).toBe(true);
    expect(isMissingPartition(err)).toBe(false);
  });

  it('an identity rule violation is a data error (client_claimed must not fill user_email)', async () => {
    const err = await caught(() => ingest.insertBatch([apiRequestRow(app.id, { identitySource: 'client_claimed' })]));
    expect(isDataError(err)).toBe(true);
  });

  it('an insert with no partition for its month is classified as a missing partition', async () => {
    const err = await caught(() =>
      ingest.insertBatch([apiRequestRow(app.id, { occurredAt: new Date('2099-01-15T00:00:00Z') })]),
    );
    expect(isMissingPartition(err)).toBe(true);
    expect(isDataError(err)).toBe(false);
  });
});
