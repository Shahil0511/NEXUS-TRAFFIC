/**
 * Database-level constants shared by the migration runner, the schema guard and jobs.
 */
import path from 'node:path';

export const DB_SCHEMA = 'traffic';
export const APP_ROLE = 'nexus_app';

/** apps/api/migrations — same relative location from src/db (tsx) and dist/db (compiled). */
export const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

/** Advisory lock keys (bigint-safe integers). */
export const ADVISORY_LOCKS = {
  migrate: 7_401_001,
  partitions: 7_401_002,
  retention: 7_401_003,
} as const;

/** Tables partitioned monthly by occurred_at (whitelisted in the SQL partition functions too). */
export const PARTITIONED_TABLES = ['api_requests', 'web_events'] as const;
export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];
