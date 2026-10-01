/**
 * Compares the migration files on disk with the `traffic.schema_migrations` ledger.
 * Used at api boot (refuse to start on pending/drifted migrations) and by /health/ready.
 * Unknown-applied versions (DB ahead of code, e.g. after a rollback) only WARN.
 */
import type { Pool } from 'pg';

import { notImplemented } from '../../lib/not-implemented';
import type { Logger } from '../../lib/logger';

export interface SchemaStatus {
  pending: string[];
  drifted: string[];
  unknownApplied: string[];
}

export class SchemaGuard {
  constructor(
    private readonly db: Pool,
    private readonly migrationsDir: string,
  ) {}

  async check(): Promise<SchemaStatus> {
    void this.db;
    void this.migrationsDir;
    throw notImplemented('SchemaGuard.check');
  }

  /** Throws when anything is pending or drifted; logs a warning for unknown-applied versions. */
  async assertCurrent(logger: Logger): Promise<void> {
    void logger;
    throw notImplemented('SchemaGuard.assertCurrent');
  }
}
