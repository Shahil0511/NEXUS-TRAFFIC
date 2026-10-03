/**
 * The Live backfill as ticks: one LiveTickDto per minute of the last LIVE_SNAPSHOT_MINUTES, built
 * from the minute buckets of both event tables, gap-filled, oldest first.
 *
 * WHY PURE: the client upserts socket ticks into this same array by `minute`, so the snapshot
 * ticks must have exactly the shape and the minute boundaries of LiveWindow ticks.
 */
import { LIVE_SNAPSHOT_MINUTES, type LiveTickDto } from '@nexus/shared';

import { roundOrNull } from './numbers';
import type { ActivityBucketRow, TrafficBucketRow } from './rows';
import { bucketStartOf, bucketStarts, type SeriesWindow } from './timeseries-gaps';

const MS_PER_MINUTE = 60_000;

/** The snapshot window: the current minute and the LIVE_SNAPSHOT_MINUTES − 1 before it, up to now. */
export function liveSnapshotWindow(now: Date): SeriesWindow {
  const currentMinute = bucketStartOf(now, 'minute').getTime();
  return {
    from: new Date(currentMinute - (LIVE_SNAPSHOT_MINUTES - 1) * MS_PER_MINUTE),
    to: now,
    grain: 'minute',
  };
}

export interface LiveTickSources {
  scope: string;
  window: SeriesWindow;
  traffic: readonly TrafficBucketRow[];
  activity: readonly ActivityBucketRow[];
  /** "Active users now" — carried by the NEWEST tick only (history is not tracked: 0). */
  activeUsersNow: number;
}

/** One tick per minute of the window, oldest first; minutes without rows are zeros. */
export function toLiveTicks(sources: LiveTickSources): LiveTickDto[] {
  const traffic = new Map(sources.traffic.map((row) => [row.bucket.toISOString(), row]));
  const activity = new Map(sources.activity.map((row) => [row.bucket.toISOString(), row]));
  const starts = bucketStarts(sources.window);
  return starts.map((start, index) => {
    const minute = start.toISOString();
    const t = traffic.get(minute);
    const a = activity.get(minute);
    return {
      scope: sources.scope,
      minute,
      requests: t?.requests ?? 0,
      errors4xx: t?.errors_4xx ?? 0,
      errors5xx: t?.errors_5xx ?? 0,
      p95Ms: roundOrNull(t?.p95_ms ?? null),
      pageViews: a?.page_views ?? 0,
      toolUses: a?.tool_uses ?? 0,
      activeUsers: index === starts.length - 1 ? sources.activeUsersNow : 0,
    };
  });
}
