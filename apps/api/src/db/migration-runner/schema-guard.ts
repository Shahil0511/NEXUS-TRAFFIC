/**
 * Compares the migration files on disk with the `traffic.schema_migrations` ledger.
 * Used at api boot (refuse to start on pending/drifted migrations) and by /health/ready.
 * Unknown-applied versions (DB ahead of code, e.g. after a rollback) only WARN.
 *
 * Runs as the api's login: nexus_app in DB_APP_ROLE_MODE=separate (SELECT on schema_migrations is
 * granted by ./grants.ts), or the owner itself in 'owner' mode.
 * @see ./plan.ts
 * @see ./grants.ts
 */
import type { Pool } from 'pg';

import type { Logger } from '../../lib/logger';
import { readLedger } from './ledger';
import { loadMigrations, migrationLabel, type MigrationFile } from './loader';
import { planMigrations } from './plan';

export interface SchemaStatus {
  pending: string[];
  drifted: string[];
  unknownApplied: string[];
}

/** WHY a distinct type: boot fails with an explicit "run migrate" message, not a SQL error. */
export class SchemaNotCurrentError extends Error {}

export class SchemaGuard {
  /** Files never change while the process runs, so they are read once. */
  private files: Promise<MigrationFile[]> | null = null;

  constructor(
    private readonly db: Pool,
    private readonly migrationsDir: string,
  ) {}

  /** Labels (`0004_api_requests`) of pending, drifted and unknown-applied migrations. */
  async check(): Promise<SchemaStatus> {
    const [files, applied] = await Promise.all([this.loadFiles(), readLedger(this.db)]);
    const plan = planMigrations(files, applied);
    return {
      pending: plan.pending.map(migrationLabel),
      drifted: plan.drifted.map((d) => migrationLabel(d.file)),
      unknownApplied: plan.unknownApplied.map(migrationLabel),
    };
  }

  /** Throws when anything is pending or drifted; logs a warning for unknown-applied versions. */
  async assertCurrent(logger: Logger): Promise<void> {
    const status = await this.check();
    if (status.unknownApplied.length > 0) {
      logger.warn('database schema is ahead of this code (rolled-back deploy?)', {
        unknownApplied: status.unknownApplied,
      });
    }
    if (status.pending.length > 0 || status.drifted.length > 0) {
      throw new SchemaNotCurrentError(
        `database schema is not current — pending: [${status.pending.join(', ')}], ` +
          `drifted: [${status.drifted.join(', ')}]; run the migrate service first`,
      );
    }
  }

  private loadFiles(): Promise<MigrationFile[]> {
    if (!this.files) {
      this.files = loadMigrations(this.migrationsDir).catch((err: unknown) => {
        this.files = null;
        throw err;
      });
    }
    return this.files;
  }
}
