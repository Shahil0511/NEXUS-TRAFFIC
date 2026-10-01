/**
 * WRITE side of `traffic.api_requests`: one multi-row INSERT per ingest batch.
 *
 * INVARIANTS
 * - `received_at` is NEVER app-supplied: it is omitted from the column list (DB default now()).
 * - Idempotent: ON CONFLICT (occurred_at, event_id) DO NOTHING; returns only the inserted event ids,
 *   so the service reports `duplicates = sent - inserted`.
 * @see ../../migrations/0004_api_requests.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { ApiRequestInsert } from '../domain/inserts';
import { notImplemented } from '../lib/not-implemented';

export class ApiRequestIngestRepository {
  constructor(private readonly db: Pool) {}

  /** Inserts the batch with a single `INSERT … SELECT FROM unnest(...)`; returns inserted event ids. */
  async insertBatch(rows: ApiRequestInsert[], exec: Executor = this.db): Promise<string[]> {
    void rows;
    void exec;
    throw notImplemented('ApiRequestIngestRepository.insertBatch');
  }
}
