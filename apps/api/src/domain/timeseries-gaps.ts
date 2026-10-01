/**
 * Continuous chart series: SQL `GROUP BY bucket` returns only buckets that HAVE rows, so a quiet
 * hour would vanish from the line chart and the x-axis would lie. These pure helpers produce every
 * bucket of the window and fill the missing ones with zeros.
 *
 * WHY HERE: pure, unit-tested once, shared by the Overview, Routes and Errors charts. Bucket starts
 * MUST match the SQL bucket expression (`bucketExpr` in src/db/sql.ts): IST-aligned `date_bin` for
 * minute/hour and IST midnight for day. Asia/Kolkata has no DST, so a fixed offset is exact.
 */
import { GRAIN_MS, type Grain, type TimeseriesPointDto } from '@nexus/shared';

import { BUCKET_ORIGIN_ISO } from '../db/sql';

const BUCKET_ORIGIN_MS = Date.parse(BUCKET_ORIGIN_ISO);

/** The window a series covers (`from` inclusive, `to` exclusive). */
export interface SeriesWindow {
  from: Date;
  to: Date;
  grain: Grain;
}

/** Start of the bucket containing `at` (same result as the SQL bucket expression). */
export function bucketStartOf(at: Date, grain: Grain): Date {
  const stride = GRAIN_MS[grain];
  const index = Math.floor((at.getTime() - BUCKET_ORIGIN_MS) / stride);
  return new Date(BUCKET_ORIGIN_MS + index * stride);
}

/** Every bucket start of the window, oldest first: from the bucket containing `from` up to `to`. */
export function bucketStarts(window: SeriesWindow): Date[] {
  const stride = GRAIN_MS[window.grain];
  const starts: Date[] = [];
  for (
    let at = bucketStartOf(window.from, window.grain).getTime();
    at < window.to.getTime();
    at += stride
  ) {
    starts.push(new Date(at));
  }
  return starts;
}

/** A bucket with no traffic. */
export function emptyPoint(bucket: Date): TimeseriesPointDto {
  return {
    bucket: bucket.toISOString(),
    requests: 0,
    errors4xx: 0,
    errors5xx: 0,
    p95Ms: null,
    pageViews: 0,
  };
}

/**
 * One point per bucket of the window, oldest first: existing points are kept as they are, missing
 * buckets become `emptyPoint`. A point outside the expected buckets is kept too (never drop data).
 */
export function fillTimeseriesGaps(
  points: readonly TimeseriesPointDto[],
  window: SeriesWindow,
): TimeseriesPointDto[] {
  const byBucket = new Map<string, TimeseriesPointDto>();
  for (const start of bucketStarts(window)) byBucket.set(start.toISOString(), emptyPoint(start));
  for (const point of points) byBucket.set(point.bucket, point);
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Copies page-view counts (keyed by ISO bucket) onto the matching points; others keep theirs. */
export function withPageViews(
  points: readonly TimeseriesPointDto[],
  pageViewsByBucket: ReadonlyMap<string, number>,
): TimeseriesPointDto[] {
  return points.map((point) => ({
    ...point,
    pageViews: pageViewsByBucket.get(point.bucket) ?? point.pageViews,
  }));
}
