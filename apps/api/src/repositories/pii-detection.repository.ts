/**
 * Hourly PII detections per app (source, field, kind) — WRITE side of `traffic.pii_detections`,
 * read by the Integration Health page (ADR 0010).
 *
 * INVARIANTS
 * - Field names, kinds and counts ONLY — the matched value is NEVER passed here.
 * - Additive upsert of the IST hour containing `at`; rows unnested and GROUPED (one statement).
 * @see ../../migrations/0011_pii_detections.sql
 */
import type { IngestSource } from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';
import type { PiiDetectionIncrement } from '../domain/inserts';

export const INCREMENT_PII_DETECTIONS_SQL = `INSERT INTO traffic.pii_detections
   (app_id, source, field, kind, bucket_hour, detections)
SELECT $1::uuid, $2::text, r.field, r.kind, ${bucketExpr('hour', '$3::timestamptz')}, sum(r.detections)::int
  FROM unnest($4::text[], $5::text[], $6::int4[]) AS r(field, kind, detections)
 GROUP BY r.field, r.kind
ON CONFLICT (app_id, source, field, kind, bucket_hour) DO UPDATE
   SET detections = traffic.pii_detections.detections + EXCLUDED.detections`;

export class PiiDetectionRepository {
  constructor(private readonly db: Pool) {}

  /** Adds `rows` to the counts of the hour containing `at` (no-op for an empty list). */
  async increment(
    appId: string,
    source: IngestSource,
    rows: readonly PiiDetectionIncrement[],
    at: Date,
    exec: Executor = this.db,
  ): Promise<void> {
    if (rows.length === 0) return;
    await exec.query(INCREMENT_PII_DETECTIONS_SQL, [
      appId,
      source,
      at,
      rows.map((r) => r.field),
      rows.map((r) => r.kind),
      rows.map((r) => r.detections),
    ]);
  }
}
