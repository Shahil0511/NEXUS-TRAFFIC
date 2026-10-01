/**
 * Hourly ingest counters per app and source (accepted / duplicates / rejected / rate-limited),
 * read by the Integration Health page.
 * @see ../../migrations/0006_ingest_counters.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { IngestCounterIncrement } from '../domain/inserts';
import { notImplemented } from '../lib/not-implemented';

export class IngestCounterRepository {
  constructor(private readonly db: Pool) {}

  /** Upserts the counters of the hour containing `at` (additive). */
  async increment(increment: IngestCounterIncrement, at: Date, exec: Executor = this.db): Promise<void> {
    void increment;
    void at;
    void exec;
    throw notImplemented('IngestCounterRepository.increment');
  }
}
