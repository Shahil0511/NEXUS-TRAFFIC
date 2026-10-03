/**
 * Plan verification item 9: with RAW_RETENTION_MONTHS=1 and back-dated partitions, the REAL
 * container's RetentionJob (config → PartitionService → PartitionRepository → the SECURITY DEFINER
 * traffic.drop_expired_partitions) drops ONLY the expired months, running AS nexus_app — a role
 * with no DDL rights of its own (DB_APP_ROLE_MODE=separate, the strictest mode).
 *
 * Owner mode (production: the api logs in as the owner) is covered by
 * migration-runner.integration.test.ts → "lets the api run as the owner: … partition functions".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { PARTITIONED_TABLES } from '../../src/db/schema';
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
});
