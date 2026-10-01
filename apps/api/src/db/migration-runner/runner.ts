/**
 * Orchestrates one `migrate` run: load files → (bootstrap) → read ledger → plan → apply →
 * ('separate' mode) re-apply the nexus_app grants → ensure partitions. Each step lives in its own module; this file only decides the ORDER and the EXIT CODE.
 *
 * WHY separate from the CLI (../migrate.ts): the integration tests drive exactly the same code with
 * a test database and a trimmed/edited migrations directory, without spawning processes.
 *
 * Exit rules (ADR 0001):
 * - checksum drift            → MIGRATE_EXIT_CODES.drift, nothing is applied
 * - a migration fails         → MIGRATE_EXIT_CODES.failed (that file is rolled back)
 * - unknown-applied versions  → warning only, exit ok (rollback with `git checkout <old>` works)
 */
import type { Pool } from 'pg';

import type { Logger } from '../../lib/logger';
import { PartitionRepository } from '../../repositories/partition.repository';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK } from '../../services/partition.service';
import { applyMigration } from './applier';
import { bootstrapDatabase, type AppRole } from './bootstrap';
import { applyAppRoleGrantsLocked } from './grants';
import { readLedger } from './ledger';
import { loadMigrations, migrationLabel } from './loader';
import { planMigrations, type MigrationPlan } from './plan';

export const MIGRATE_EXIT_CODES = {
  ok: 0,
  failed: 1,
  drift: 2,
} as const;
export type MigrateExitCode = (typeof MIGRATE_EXIT_CODES)[keyof typeof MIGRATE_EXIT_CODES];

/** apply = normal run; status = report only; dry = report what would be applied. */
export const MIGRATE_MODE_VALUES = ['apply', 'status', 'dry'] as const;
export type MigrateMode = (typeof MIGRATE_MODE_VALUES)[number];

/** CLI flags → mode: `--status` / `--dry` / none. Unknown flags throw (a typo must not apply). */
export function parseMigrateMode(argv: readonly string[]): MigrateMode {
  const flags = argv.filter((arg) => arg.startsWith('-'));
  const unknown = flags.filter((flag) => flag !== '--status' && flag !== '--dry');
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(' ')} (use --status or --dry)`);
  if (flags.includes('--status')) return 'status';
  if (flags.includes('--dry')) return 'dry';
  return 'apply';
}

export interface RunMigrationsOptions {
  /** Owner pool (the MIGRATION_DATABASE_URL login) — NEVER the nexus_app pool. */
  pool: Pool;
  migrationsDir: string;
  /** DB_APP_ROLE_MODE: 'separate' manages nexus_app (password + grants); 'owner' touches no role. */
  appRole: AppRole;
  mode: MigrateMode;
  logger: Logger;
}

export interface MigrationRunResult {
  exitCode: MigrateExitCode;
  plan: MigrationPlan;
  /** Labels (`0004_api_requests`) applied by THIS run. */
  applied: string[];
  /** Partition names ensured after applying (apply mode only). */
  partitions: string[];
}

// ─── Connection ─────────────────────────────────────────────────────────────

export interface ConnectRetryOptions {
  attempts: number;
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Postgres may still be starting when the migrate container runs: try `attempts` times. */
export const DEFAULT_CONNECT_RETRY: ConnectRetryOptions = { attempts: 10, delayMs: 2000 };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once `SELECT 1` succeeds; rethrows the last error after the final attempt. */
export async function connectWithRetry(
  pool: Pick<Pool, 'query'>,
  logger: Logger,
  options: ConnectRetryOptions = DEFAULT_CONNECT_RETRY,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt >= options.attempts) throw err;
      logger.warn('database not reachable yet, retrying', { attempt, of: options.attempts });
      await sleep(options.delayMs);
    }
  }
}

/** `host:port/db` — the ONLY way a connection string is ever printed (no user, no password). */
export function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)';
    return `${url.hostname}${url.port ? `:${url.port}` : ''}/${database}`;
  } catch {
    return '(unparseable connection string)';
  }
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function logPlan(plan: MigrationPlan, logger: Logger): void {
  logger.info('migration status', {
    pending: plan.pending.map(migrationLabel),
    drifted: plan.drifted.map((d) => migrationLabel(d.file)),
    unknownApplied: plan.unknownApplied.map(migrationLabel),
  });
  for (const d of plan.drifted) {
    logger.error('checksum drift: an applied migration file was edited', {
      migration: migrationLabel(d.file),
      appliedChecksum: d.applied.checksum,
      fileChecksum: d.file.checksum,
    });
  }
  if (plan.unknownApplied.length > 0) {
    logger.warn('database has migrations this code does not know (rolled-back deploy?)', {
      unknownApplied: plan.unknownApplied.map(migrationLabel),
    });
  }
  if (plan.outOfOrder.length > 0) {
    logger.warn('pending migrations are older than the newest applied one', {
      outOfOrder: plan.outOfOrder.map(migrationLabel),
    });
  }
}

/** Applies pending files in order; stops at the first failure. */
async function applyPending(
  pool: Pool,
  plan: MigrationPlan,
  logger: Logger,
): Promise<{ applied: string[]; failed: boolean }> {
  const applied: string[] = [];
  for (const file of plan.pending) {
    const label = migrationLabel(file);
    try {
      const outcome = await applyMigration(pool, file);
      if (outcome.status === 'skipped') {
        logger.info('migration already applied by another run', { migration: label });
        continue;
      }
      applied.push(label);
      logger.info('migration applied', { migration: label, executionMs: Math.round(outcome.executionMs) });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      logger.error('migration failed (rolled back)', { migration: label, code: e.code, error: e.message });
      return { applied, failed: true };
    }
  }
  return { applied, failed: false };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/** One full run; see the exit rules in the header. Unexpected errors (connection, bootstrap) throw. */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationRunResult> {
  const { pool, migrationsDir, appRole, mode, logger } = options;
  const files = await loadMigrations(migrationsDir);

  if (mode === 'apply') await bootstrapDatabase(pool, appRole);

  const plan = planMigrations(files, await readLedger(pool));
  logPlan(plan, logger);
  const result: MigrationRunResult = { exitCode: MIGRATE_EXIT_CODES.ok, plan, applied: [], partitions: [] };

  if (plan.drifted.length > 0) return { ...result, exitCode: MIGRATE_EXIT_CODES.drift };
  if (mode === 'status') return result;
  if (mode === 'dry') {
    logger.info('dry run: would apply', { migrations: plan.pending.map(migrationLabel) });
    return result;
  }

  const { applied, failed } = await applyPending(pool, plan, logger);
  if (failed) return { ...result, applied, exitCode: MIGRATE_EXIT_CODES.failed };

  // BEFORE the partitions, so the default privileges already cover partitions created below.
  if (appRole.mode === 'separate') {
    await applyAppRoleGrantsLocked(pool);
    logger.info('app role grants applied', { role: 'nexus_app' });
  }

  const partitions = await new PartitionRepository(pool).ensure(PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD);
  logger.info('migrations complete', {
    appliedCount: applied.length,
    partitionCount: partitions.length,
    appRoleMode: appRole.mode,
  });
  return { ...result, applied, partitions };
}
