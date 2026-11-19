/**
 * Pure folding of one batch's diagnostics into the rows of the hourly counter tables (A3/A8/A9).
 * Used ONLY by IngestService after commit. No values, no messages — keys and counts only.
 * @see ../../migrations/0010_ingest_rejections.sql
 * @see ../../migrations/0011_pii_detections.sql
 * @see ../../migrations/0012_sso_cookie_outcomes.sql
 */
import {
  REJECTION_MAX_DISTINCT_PER_BATCH,
  type BeaconOrigin,
  type IngestRejectionCode,
  type IngestSource,
  type PiiField,
  type PiiKind,
} from '@nexus/shared';

import type { IngestRejectionIncrement, PiiDetectionIncrement } from './inserts';
import { NO_SCHEMA_PATH } from './schema-path';

/** One rejected event as the KPI sees it. */
export interface RejectionKey {
  code: IngestRejectionCode;
  schemaPath: string;
}

/**
 * WHY capped: a sender controls how many distinct (code, schema_path) keys one batch produces. At
 * most REJECTION_MAX_DISTINCT_PER_BATCH distinct keys are kept; any later NEW key folds into
 * (code, '') — so one batch adds at most that many keys plus one per code.
 */
export function toRejectionIncrements(
  source: IngestSource,
  sdk: string,
  rejected: readonly RejectionKey[],
): IngestRejectionIncrement[] {
  const counts = new Map<string, IngestRejectionIncrement>();
  for (const { code, schemaPath } of rejected) {
    const capped = !counts.has(`${code}|${schemaPath}`) && counts.size >= REJECTION_MAX_DISTINCT_PER_BATCH;
    const path = capped ? NO_SCHEMA_PATH : schemaPath;
    const key = `${code}|${path}`;
    const current = counts.get(key);
    if (current) current.rejected += 1;
    else counts.set(key, { source, sdk, code, schemaPath: path, rejected: 1 });
  }
  return [...counts.values()];
}

/** WHY: one detection per (event, field, kind) — the events' findings summed per (field, kind). */
export function toPiiIncrements(
  findingsPerEvent: readonly (readonly { field: PiiField; kind: PiiKind }[])[],
): PiiDetectionIncrement[] {
  const counts = new Map<string, PiiDetectionIncrement>();
  for (const findings of findingsPerEvent) {
    for (const { field, kind } of findings) {
      const key = `${field}|${kind}`;
      const current = counts.get(key);
      if (current) current.detections += 1;
      else counts.set(key, { field, kind, detections: 1 });
    }
  }
  return [...counts.values()];
}

/**
 * WHY: a cross-origin beacon cannot carry the SSO cookie — this explains a `no-cookie` outcome.
 * `publicOrigin` is `new URL(env.PUBLIC_ORIGIN).origin`; comparison is case-insensitive.
 */
export function beaconOriginOf(requestOrigin: string | null, publicOrigin: string): BeaconOrigin {
  if (!requestOrigin) return 'none';
  const normalise = (origin: string) => origin.replace(/\/$/, '').toLowerCase();
  return normalise(requestOrigin) === normalise(publicOrigin) ? 'same_origin' : 'cross_origin';
}
