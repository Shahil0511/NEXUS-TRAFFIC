/**
 * The migration ledger `traffic.schema_migrations`: which versions are applied, with the checksum
 * they had when applied (so a later edit of an applied file is detected as drift).
 *
 * WHY a separate module: the bootstrap creates the table, the applier writes it, and both the
 * runner and the api's SchemaGuard read it — one definition of its shape for all of them.
 */
import type { Executor } from '../executor';
import type { MigrationFile } from './loader';

/** One applied migration as recorded in the ledger. */
export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  appliedAt: Date;
  executionMs: number;
}

interface LedgerRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
  execution_ms: number;
}

/** Idempotent DDL, run by the bootstrap as the owner on every migrate run. */
export async function ensureLedger(exec: Executor): Promise<void> {
  await exec.query(`
    CREATE TABLE IF NOT EXISTS traffic.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL
    )
  `);
}

/** True when the ledger table exists (it does not before the first migrate run). */
export async function ledgerExists(exec: Executor): Promise<boolean> {
  const { rows } = await exec.query<{ present: boolean }>(
    `SELECT to_regclass('traffic.schema_migrations') IS NOT NULL AS present`,
  );
  return rows[0]?.present === true;
}

/** Applied migrations ordered by version; empty when the ledger does not exist yet. */
export async function readLedger(exec: Executor): Promise<AppliedMigration[]> {
  if (!(await ledgerExists(exec))) return [];
  const { rows } = await exec.query<LedgerRow>(
    `SELECT version, name, checksum, applied_at, execution_ms
       FROM traffic.schema_migrations
      ORDER BY version`,
  );
  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
    executionMs: row.execution_ms,
  }));
}

/** True when `version` is already recorded (re-checked under the migrate lock). */
export async function isRecorded(exec: Executor, version: string): Promise<boolean> {
  const { rows } = await exec.query(`SELECT 1 FROM traffic.schema_migrations WHERE version = $1`, [version]);
  return rows.length > 0;
}

/** Records a successful apply — called inside the migration's own transaction. */
export async function recordMigration(exec: Executor, file: MigrationFile, executionMs: number): Promise<void> {
  await exec.query(
    `INSERT INTO traffic.schema_migrations (version, name, checksum, execution_ms)
     VALUES ($1, $2, $3, $4)`,
    [file.version, file.name, file.checksum, Math.round(executionMs)],
  );
}
