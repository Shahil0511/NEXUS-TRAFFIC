/**
 * Disposable database per integration-test file.
 *
 * WHY: every DB suite gets a FRESH, uniquely-named database on the test cluster, migrated with the
 * real runner (bootstrap + migrations + partitions), so suites never see each other's rows and
 * the migrations themselves are exercised on every run. Two pools come back:
 * - ownerPool: the owner (superuser on the test cluster), as the `migrate` service connects;
 * - appPool:   role nexus_app with EXACTLY the runtime write-pool options (src/db/pool.ts).
 *
 * Cluster URL: TEST_PG_ADMIN_URL, default = the disposable local Postgres 17 used in development.
 * Roles are cluster-wide, so every suite uses the same TEST_APP_PASSWORD for nexus_app.
 */
import { randomBytes } from 'node:crypto';

import { Client, Pool } from 'pg';

import { createWritePool } from '../../src/db/pool';
import { MIGRATE_EXIT_CODES, runMigrations } from '../../src/db/migration-runner/runner';
import { APP_ROLE, MIGRATIONS_DIR } from '../../src/db/schema';
import { createLogger, type Logger } from '../../src/lib/logger';

/** Suites call `describe.skipIf(!RUN_DB_TESTS)`. */
export const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

export const TEST_ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:testpw@127.0.0.1:55432/postgres';

/** nexus_app password on the TEST cluster only (≥ 16 chars, like production). */
export const TEST_APP_PASSWORD = 'nexus-app-test-password-0001';

/** Errors only — migration progress lines would drown the test output. */
export const quietLogger: Logger = createLogger('error');

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
  ownerPool: Pool;
  appPool: Pool;
  /** Ends both pools and drops the database (WITH FORCE). */
  drop(): Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** Run bootstrap + migrations + ensure_partitions (default true). */
  migrate?: boolean;
}

/** Same cluster as TEST_ADMIN_URL, another database and/or role. */
export function databaseUrl(database: string, role?: { user: string; password: string }): string {
  const url = new URL(TEST_ADMIN_URL);
  url.pathname = `/${database}`;
  if (role) {
    url.username = role.user;
    url.password = role.password;
  }
  return url.toString();
}

async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: TEST_ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** `nx_test_<label>_<random>` — a safe identifier (lower-case letters, digits, underscores). */
function uniqueDatabaseName(label: string): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
  return `nx_test_${safeLabel}_${randomBytes(4).toString('hex')}`;
}

export async function createTestDatabase(
  label: string,
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = uniqueDatabaseName(label);
  await withAdminClient((client) => client.query(`CREATE DATABASE "${name}"`));

  const ownerUrl = databaseUrl(name);
  const appUrl = databaseUrl(name, { user: APP_ROLE, password: TEST_APP_PASSWORD });
  const ownerPool = new Pool({ connectionString: ownerUrl, max: 3, application_name: 'nexus-test-owner' });
  const appPool = createWritePool(appUrl, 4, quietLogger);

  const drop = async () => {
    await Promise.allSettled([ownerPool.end(), appPool.end()]);
    await withAdminClient((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  };

  if (options.migrate ?? true) {
    try {
      const result = await runMigrations({
        pool: ownerPool,
        migrationsDir: MIGRATIONS_DIR,
        appPassword: TEST_APP_PASSWORD,
        mode: 'apply',
        logger: quietLogger,
      });
      if (result.exitCode !== MIGRATE_EXIT_CODES.ok) throw new Error(`test migrate exited ${result.exitCode}`);
    } catch (err) {
      await drop();
      throw err;
    }
  }
  return { name, ownerUrl, appUrl, ownerPool, appPool, drop };
}

// ─── Small helpers shared by the suites ─────────────────────────────────────

/** First day of the UTC month `offset` months from `base` (offset may be negative). */
export function utcMonthStart(base: Date, offset = 0): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
}

/** `api_requests_y2026m10` for the month containing `month` (UTC). */
export function partitionName(table: string, month: Date): string {
  const yyyy = String(month.getUTCFullYear());
  const mm = String(month.getUTCMonth() + 1).padStart(2, '0');
  return `${table}_y${yyyy}m${mm}`;
}

/** 'YYYY-MM-DD' of a UTC date (for date parameters). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Runs `fn` and returns what it threw (fails the test if it did not throw). */
export async function caught(fn: () => Promise<unknown>): Promise<{ code?: string; message: string; constraint?: string }> {
  try {
    await fn();
  } catch (err) {
    return err as { code?: string; message: string; constraint?: string };
  }
  throw new Error('expected the operation to throw');
}
