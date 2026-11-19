/**
 * Prunes the hourly diagnostic tables (ingest_rejections, pii_detections, sso_cookie_outcomes)
 * older than AGGREGATE_RETENTION_DAYS. Raw events keep their own (partition-drop) retention.
 *
 * INVARIANTS
 * - Runs on the transaction client of the retention job's advisory lock (one replica at a time).
 * - Plain `DELETE … WHERE bucket_hour < $1` per table (each table has a bucket_hour index); the
 *   tables are small and unpartitioned.
 * @see ../../migrations/0010_ingest_rejections.sql
 * @see ../../migrations/0011_pii_detections.sql
 * @see ../../migrations/0012_sso_cookie_outcomes.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';

/** The aggregate tables, in the order they are pruned (trusted identifiers). */
export const AGGREGATE_TABLES = [
  'traffic.ingest_rejections',
  'traffic.pii_detections',
  'traffic.sso_cookie_outcomes',
] as const;

export class AggregateRetentionRepository {
  constructor(private readonly db: Pool) {}

  /** Deletes every hourly row before `cutoff`; returns how many rows were deleted in total. */
  async deleteExpired(cutoff: Date, exec: Executor = this.db): Promise<number> {
    let deleted = 0;
    for (const table of AGGREGATE_TABLES) {
      const result = await exec.query(`DELETE FROM ${table} WHERE bucket_hour < $1`, [cutoff]);
      deleted += result.rowCount ?? 0;
    }
    return deleted;
  }
}
