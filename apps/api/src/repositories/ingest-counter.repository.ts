/**
 * Hourly ingest counters per app and source (accepted / duplicates / rejected / rate-limited),
 * read by the Integration Health page.
 * @see ../../migrations/0006_ingest_counters.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';
import type { IngestCounterIncrement } from '../domain/inserts';

export class IngestCounterRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Upserts the counters of the hour containing `at` (additive). The hour is aligned to the
   * reporting timezone (IST), exactly like the dashboard's hourly buckets.
   */
  async increment(increment: IngestCounterIncrement, at: Date, exec: Executor = this.db): Promise<void> {
    await exec.query(
      `INSERT INTO traffic.ingest_counters
         (app_id, source, bucket_hour, accepted, duplicates, rejected, rate_limited)
       VALUES ($1, $2, ${bucketExpr('hour', '$3::timestamptz')}, $4, $5, $6, $7)
       ON CONFLICT (app_id, source, bucket_hour) DO UPDATE
          SET accepted = traffic.ingest_counters.accepted + EXCLUDED.accepted,
              duplicates = traffic.ingest_counters.duplicates + EXCLUDED.duplicates,
              rejected = traffic.ingest_counters.rejected + EXCLUDED.rejected,
              rate_limited = traffic.ingest_counters.rate_limited + EXCLUDED.rate_limited`,
      [
        increment.appId,
        increment.source,
        at,
        increment.accepted,
        increment.duplicates,
        increment.rejected,
        increment.rateLimited,
      ],
    );
  }
}
