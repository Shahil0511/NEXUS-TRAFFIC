/**
 * Plan verification item 9: with RAW_RETENTION_MONTHS=1 and back-dated partitions, the REAL
 * container's RetentionJob (config → PartitionService → PartitionRepository → the SECURITY DEFINER
 * traffic.drop_expired_partitions) drops ONLY the expired months, running AS nexus_app — a role
 * with no DDL rights of its own (DB_APP_ROLE_MODE=separate, the strictest mode).
 *
 * Owner mode (production: the api logs in as the owner) is covered by
 * migration-runner.integration.test.ts → "lets the api run as the owner: … partition functions".
 * The same run (same advisory lock) also deletes hourly diagnostic aggregates older than
 * AGGREGATE_RETENTION_DAYS (ADR 0013).
 */
import { AGGREGATE_RETENTION_DAYS } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { PARTITIONED_TABLES } from '../../src/db/schema';
import { RetentionJob } from '../../src/jobs/retention.job';
import { FixedClock } from '../../src/lib/clock';
import { recordingLogger } from '../fixtures/recording-logger';
import {
  RUN_DB_TESTS,
  createTestDatabase,
  isoDate,
  partitionName,
  utcMonthStart,
  type TestDatabase,
} from './test-database';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** 02:45 IST today — inside the job's 02:30–03:30 IST window. */
function insideRetentionWindow(now: Date): Date {
  const istMidnight = Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000;
  return new Date(istMidnight - IST_OFFSET_MS + (2 * 60 + 45) * 60_000);
}

describe.skipIf(!RUN_DB_TESTS)('RetentionJob as nexus_app, RAW_RETENTION_MONTHS=1 (db)', () => {
  let db: TestDatabase;
  let container: Container;
  const now = new Date();

  async function partitionsOf(table: string): Promise<string[]> {
    const { rows } = await db.ownerPool.query<{ name: string }>(
      `SELECT child.relname AS name
         FROM pg_inherits inh
         JOIN pg_class child ON child.oid = inh.inhrelid
        WHERE inh.inhparent = $1::regclass
        ORDER BY 1`,
      [`traffic.${table}`],
    );
    return rows.map((r) => r.name);
  }

  beforeAll(async () => {
    db = await createTestDatabase('retention_job');
    // Back-date: four months before the current one (the migration created -1 … +2).
    for (const table of PARTITIONED_TABLES) {
      for (let back = 4; back >= 2; back -= 1) {
        await db.ownerPool.query('SELECT traffic.ensure_monthly_partition($1, $2::date)', [
          table,
          isoDate(utcMonthStart(now, -back)),
        ]);
      }
    }
    const config = parseConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: db.appUrl,
      RAW_RETENTION_MONTHS: '1',
      LIBAS_JWT_SECRET: 'retention-jwt-secret-'.padEnd(48, 'x'),
      API_KEY_PEPPER: 'a'.repeat(64),
      USER_KEY_SECRET: 'b'.repeat(64),
      IP_HASH_SECRET: 'c'.repeat(64),
    });
    container = createContainer(config, {
      logger: recordingLogger().logger,
      clock: new FixedClock(insideRetentionWindow(now)),
    });
  });

  afterAll(async () => {
    if (container)
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    await db?.drop();
  });

  it('the write pool really is nexus_app (no DDL rights of its own)', async () => {
    const { rows } = await container.pools.write.query<{ role: string; can_create: boolean }>(
      `SELECT current_user AS role, has_schema_privilege('traffic', 'CREATE') AS can_create`,
    );
    expect(rows[0]).toEqual({ role: 'nexus_app', can_create: false });
  });

  it('drops only the months older than current − 1, in both tables', async () => {
    await container.jobs.retention.run();

    for (const table of PARTITIONED_TABLES) {
      const expected = [-1, 0, 1, 2].map((m) => partitionName(table, utcMonthStart(now, m)));
      expect(await partitionsOf(table)).toEqual(expected);
    }
  });

  it('a second run the same IST day is a no-op (once per day)', async () => {
    await db.ownerPool.query('SELECT traffic.ensure_monthly_partition($1, $2::date)', [
      'api_requests',
      isoDate(utcMonthStart(now, -3)),
    ]);
    await container.jobs.retention.run();
    expect(await partitionsOf('api_requests')).toContain(
      partitionName('api_requests', utcMonthStart(now, -3)),
    );
  });

  it('deletes diagnostic aggregates older than AGGREGATE_RETENTION_DAYS (same run, same lock)', async () => {
    const { rows: apps } = await db.ownerPool.query<{ id: string }>(
      `INSERT INTO traffic.apps (slug, display_name, created_by) VALUES ('retention-app', 'R', 'admin@example.com')
       RETURNING id`,
    );
    const appId = apps[0]!.id;
    const expired = new Date(now.getTime() - (AGGREGATE_RETENTION_DAYS + 2) * 86_400_000);
    const kept = new Date(now.getTime() - 86_400_000);
    for (const at of [expired, kept]) {
      await db.ownerPool.query(
        `INSERT INTO traffic.ingest_rejections (app_id, source, code, bucket_hour, rejected)
         VALUES ($1, 'server', 'INVALID_EVENT', $2, 1)`,
        [appId, at],
      );
      await db.ownerPool.query(
        `INSERT INTO traffic.pii_detections (app_id, source, field, kind, bucket_hour, detections)
         VALUES ($1, 'browser', 'path', 'phone', $2, 1)`,
        [appId, at],
      );
      await db.ownerPool.query(
        `INSERT INTO traffic.sso_cookie_outcomes (app_id, outcome, beacon_origin, bucket_hour, beacons)
         VALUES ($1, 'ok', 'none', $2, 1)`,
        [appId, at],
      );
    }
    // A fresh job instance: the container's one already ran today.
    const job = new RetentionJob(
      container.pools.write,
      container.services.partitions,
      container.services.aggregateRetention,
      new FixedClock(insideRetentionWindow(now)),
      recordingLogger().logger,
    );
    await job.run();
    for (const table of ['ingest_rejections', 'pii_detections', 'sso_cookie_outcomes']) {
      const { rows } = await db.ownerPool.query<{ bucket_hour: Date }>(
        `SELECT bucket_hour FROM traffic.${table} WHERE app_id = $1`,
        [appId],
      );
      expect(rows.map((r) => r.bucket_hour.getTime())).toEqual([kept.getTime()]);
    }
  });
});
