/**
 * Pure state helpers of the Live page: how socket ticks and event batches are merged into what
 * the page already shows (the REST snapshot + earlier messages).
 *
 * WHY PURE: the merge rules are the subtle part of a live view (duplicates after a reconnect,
 * out-of-order ticks, an unbounded table) — kept out of React so they are unit-tested directly.
 */
import {
  LIVE_SNAPSHOT_MINUTES,
  type LiveEventDto,
  type LiveSnapshotDto,
  type LiveTickDto,
  type TimeseriesPointDto,
} from '@nexus/shared';

/** Most rows the streaming table keeps (older ones fall off the bottom). */
export const LIVE_FEED_BUFFER = 200;

/**
 * A socket tick applied to the cached snapshot: ticks are CUMULATIVE for their minute, so a tick
 * REPLACES the one with the same `minute`; a new minute is appended and the oldest dropped
 * (LIVE_SNAPSHOT_MINUTES kept). Before the snapshot has loaded there is nothing to update.
 */
export function upsertTick(
  snapshot: LiveSnapshotDto | undefined,
  tick: LiveTickDto,
): LiveSnapshotDto | undefined {
  if (!snapshot) return snapshot;
  const others = snapshot.ticks.filter((t) => t.minute !== tick.minute);
  const ticks = [...others, tick]
    .sort((a, b) => a.minute.localeCompare(b.minute))
    .slice(-LIVE_SNAPSHOT_MINUTES);
  return { ...snapshot, ticks };
}

/** Newest first (occurredAt, then eventId for a stable order). */
function newestFirst(a: LiveEventDto, b: LiveEventDto): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.eventId.localeCompare(a.eventId);
}

/**
 * `incoming` merged into `current`: de-duplicated by eventId (a reconnect can deliver an event
 * that the snapshot already holds), newest first, at most `cap` rows.
 */
export function mergeEvents(
  current: readonly LiveEventDto[],
  incoming: readonly LiveEventDto[],
  cap: number = LIVE_FEED_BUFFER,
): LiveEventDto[] {
  const byId = new Map<string, LiveEventDto>();
  for (const event of [...incoming, ...current]) {
    if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  }
  return [...byId.values()].sort(newestFirst).slice(0, cap);
}

/** The current minute (newest tick), or undefined before any tick. */
export function latestTick(ticks: readonly LiveTickDto[]): LiveTickDto | undefined {
  return ticks.at(-1);
}

/** Ticks as chart points, so the Live chart reuses the Overview's TrafficChart unchanged. */
export function ticksToPoints(ticks: readonly LiveTickDto[]): TimeseriesPointDto[] {
  return ticks.map((tick) => ({
    bucket: tick.minute,
    requests: tick.requests,
    errors4xx: tick.errors4xx,
    errors5xx: tick.errors5xx,
    p95Ms: tick.p95Ms,
    pageViews: tick.pageViews,
  }));
}
