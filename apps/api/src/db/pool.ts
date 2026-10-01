/**
 * PostgreSQL pools for the runtime role `nexus_app`.
 *
 * WHY TWO POOLS: ingest/admin writes must never queue behind slow dashboard reads.
 * - write pool: short statement timeout, fails fast (→ 503 INGEST_UNAVAILABLE) when saturated.
 * - query pool: read-only transactions, longer timeout for analytics.
 * Every connection pins search_path=traffic and timezone=UTC so SQL never depends on server defaults.
 */
import { Pool, types } from 'pg';

import type { Logger } from '../lib/logger';

// Return int8 (count(*), bigint sums) as JS numbers — our counts are far below 2^53.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));
// numeric (percentile_cont/avg results) as numbers.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

export interface PoolOptions {
  connectionString: string;
  max: number;
  statementTimeoutMs: number;
  readOnly: boolean;
  applicationName: string;
}

export function createPool(options: PoolOptions, logger: Logger): Pool {
  const settings = [
    '-c search_path=traffic',
    '-c timezone=UTC',
    `-c statement_timeout=${options.statementTimeoutMs}`,
    '-c idle_in_transaction_session_timeout=5000',
    options.readOnly ? '-c default_transaction_read_only=on' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30_000,
    application_name: options.applicationName,
    options: settings,
  });
  pool.on('error', (err) => logger.error('postgres pool error', { pool: options.applicationName, err }));
  return pool;
}

export function createWritePool(connectionString: string, max: number, logger: Logger): Pool {
  return createPool(
    { connectionString, max, statementTimeoutMs: 10_000, readOnly: false, applicationName: 'nexus-api-write' },
    logger,
  );
}

export function createQueryPool(connectionString: string, max: number, logger: Logger): Pool {
  return createPool(
    { connectionString, max, statementTimeoutMs: 15_000, readOnly: true, applicationName: 'nexus-api-query' },
    logger,
  );
}
