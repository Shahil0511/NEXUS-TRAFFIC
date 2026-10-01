/**
 * `migrate` CLI — the compose `migrate` service (`node dist/db/migrate.js`) and
 * `npm run migrate[:status] -w @nexus/api`.
 *
 *   (no flag)  bootstrap + apply pending migrations + (DB_APP_ROLE_MODE=separate) nexus_app grants
 *              + ensure partitions
 *   --status   report pending / drifted / unknown-applied (read-only)
 *   --dry      report what WOULD be applied (read-only)
 *
 * Exit code: 0 ok (unknown-applied is only a warning), 1 failed apply / error, 2 checksum drift.
 * The target is printed as host:port/db only — never the user or password.
 *
 * @see ./migration-runner/runner.ts
 * @see ../../migrations/README.md
 */
import { Pool } from 'pg';

import { createLogger, type Logger } from '../lib/logger';
import { appRoleOf, loadMigrateConfig } from './migrate-config';
import {
  connectWithRetry,
  describeTarget,
  MIGRATE_EXIT_CODES,
  parseMigrateMode,
  runMigrations,
} from './migration-runner/runner';
import { MIGRATIONS_DIR } from './schema';

const SERVICE = { service: 'nexus-traffic-migrate' };

/** Owner connection: one client is plenty, and a short connect timeout feeds the retry loop. */
function createOwnerPool(connectionString: string, logger: Logger): Pool {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: 'nexus-migrate',
  });
  pool.on('error', (err) => logger.error('postgres pool error', { error: err.message }));
  return pool;
}

async function main(): Promise<number> {
  const config = loadMigrateConfig();
  const logger = createLogger(config.LOG_LEVEL).child(SERVICE);
  const mode = parseMigrateMode(process.argv.slice(2));
  logger.info('migrate starting', {
    mode,
    appRoleMode: config.DB_APP_ROLE_MODE,
    target: describeTarget(config.MIGRATION_DATABASE_URL),
  });

  const pool = createOwnerPool(config.MIGRATION_DATABASE_URL, logger);
  try {
    await connectWithRetry(pool, logger);
    const result = await runMigrations({
      pool,
      migrationsDir: MIGRATIONS_DIR,
      appRole: appRoleOf(config),
      mode,
      logger,
    });
    return result.exitCode;
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const e = err as { code?: string; message?: string };
    createLogger('error')
      .child(SERVICE)
      .error('migrate failed', { code: e.code, error: e.message ?? String(err) });
    process.exitCode = MIGRATE_EXIT_CODES.failed;
  });
