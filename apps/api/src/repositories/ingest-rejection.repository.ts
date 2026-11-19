/**
 * Hourly rejection reasons per app (source, sdk, code, schema_path) — WRITE side of
 * `traffic.ingest_rejections`, read by the Integration Health page (ADR 0013).
 *
 * INVARIANTS
 * - Codes, normalised schema paths and strict sdk labels ONLY — never a message or a value.
 * - Additive upsert of the IST hour containing `at` (same bucket as the dashboard's hourly grain).
 * - One statement per batch: the rows are unnested and GROUPED, so duplicate keys in one call
 *   cannot trip "ON CONFLICT DO UPDATE command cannot affect row a second time".
 * @see ../../migrations/0010_ingest_rejections.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';
import type { IngestRejectionIncrement } from '../domain/inserts';

export const INCREMENT_INGEST_REJECTIONS_SQL = `INSERT INTO traffic.ingest_rejections
   (app_id, source, sdk, code, schema_path, bucket_hour, rejected)
SELECT $1::uuid, r.source, r.sdk, r.code, r.schema_path, ${bucketExpr('hour', '$2::timestamptz')}, sum(r.rejected)::int
  FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int4[])
       AS r(source, sdk, code, schema_path, rejected)
 GROUP BY r.source, r.sdk, r.code, r.schema_path
ON CONFLICT (app_id, source, sdk, code, schema_path, bucket_hour) DO UPDATE
   SET rejected = traffic.ingest_rejections.rejected + EXCLUDED.rejected`;

export class IngestRejectionRepository {
  constructor(private readonly db: Pool) {}

  /** Adds `rows` to the counts of the hour containing `at` (no-op for an empty list). */
  async increment(
    appId: string,
    rows: readonly IngestRejectionIncrement[],
    at: Date,
    exec: Executor = this.db,
  ): Promise<void> {
    if (rows.length === 0) return;
    await exec.query(INCREMENT_INGEST_REJECTIONS_SQL, [
      appId,
      at,
      rows.map((r) => r.source),
      rows.map((r) => r.sdk),
      rows.map((r) => r.code),
      rows.map((r) => r.schemaPath),
      rows.map((r) => r.rejected),
    ]);
  }
}
