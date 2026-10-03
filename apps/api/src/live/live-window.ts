/**
 * The in-memory "current minute" behind every `traffic:tick`: per scope (all apps + each app)
 * request / 4xx / 5xx / page-view / tool-use counters, a latency histogram for p95 and the set of
 * actors seen in the last ACTIVE_USER_WINDOW_MS.
 *
 * WHY IN MEMORY: a tick goes out every LIVE_TICK_MS to every subscribed scope; querying Postgres
 * for that would put a constant load on the query pool for numbers we already saw at ingest.
 * The DB stays the source of truth for history (GET ROUTES.live.snapshot backfills from it).
 *
 * RULES
 * - Counts are CUMULATIVE for the current minute (by RECEIPT time) and reset on minute rollover;
 *   the client upserts ticks by `minute`.
 * - Latency counts kind = 'http' only (same rule as the SQL percentiles; streams would skew p95).
 * - An actor is a verified user (user_key) or else a session — the same rule as
 *   WebEventQueryRepository.countActiveUsers. Requests with neither are not countable.
 * - Single api instance (ADR 0001); a multi-instance deployment needs a shared adapter (v1.1).
 */
import {
  ACTIVE_USER_WINDOW_MS,
  liveScopeKey,
  type BrowserEventType,
  type LiveTickDto,
  type ServerEventKind,
} from '@nexus/shared';

import { roundOrNull } from '../domain/numbers';
import { bucketStartOf } from '../domain/timeseries-gaps';

// ─── Latency histogram ──────────────────────────────────────────────────────

/**
 * Upper bounds (ms) of the latency buckets — roughly logarithmic, so p95 is within one bucket of
 * the truth from 5 ms to 60 s with a fixed, tiny memory footprint (no raw samples kept).
 */
export const LATENCY_BUCKET_BOUNDS_MS = [
  5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10_000, 30_000,
  60_000,
] as const;

/** The 95th percentile reported in every tick. */
const P95 = 0.95;

/** WHY: an approximate percentile over a minute of latencies in O(buckets) memory. */
export class LatencyHistogram {
  /** One slot per bound plus an overflow slot (> the last bound). */
  private readonly counts: number[] = new Array<number>(LATENCY_BUCKET_BOUNDS_MS.length + 1).fill(
    0,
  );
  private total = 0;
  private max = 0;

  record(durationMs: number): void {
    const index = LATENCY_BUCKET_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
    const slot = index === -1 ? LATENCY_BUCKET_BOUNDS_MS.length : index;
    this.counts[slot] = (this.counts[slot] ?? 0) + 1;
    this.total += 1;
    this.max = Math.max(this.max, durationMs);
  }

  /**
   * Upper bound of the bucket holding the `fraction` rank, never above the largest value seen
   * (so a minute of 3 ms calls reports 3 ms, not 5 ms). null when nothing was recorded.
   */
  percentile(fraction: number): number | null {
    if (this.total === 0) return null;
    const rank = Math.ceil(fraction * this.total);
    let seen = 0;
    for (let slot = 0; slot < this.counts.length; slot += 1) {
      seen += this.counts[slot] ?? 0;
      if (seen >= rank) {
        const bound = LATENCY_BUCKET_BOUNDS_MS[slot];
        return bound === undefined ? this.max : Math.min(bound, this.max);
      }
    }
    return this.max;
  }
}

// ─── Active presence ────────────────────────────────────────────────────────

/** WHY: "active users now" = distinct actors seen within ACTIVE_USER_WINDOW_MS, pruned lazily. */
export class ActivePresence {
  private readonly lastSeen = new Map<string, number>();

  see(actor: string, atMs: number): void {
    this.lastSeen.set(actor, Math.max(atMs, this.lastSeen.get(actor) ?? 0));
  }

  /** Drops actors older than the window, then counts the rest. */
  count(nowMs: number): number {
    const cutoff = nowMs - ACTIVE_USER_WINDOW_MS;
    for (const [actor, at] of this.lastSeen) {
      if (at <= cutoff) this.lastSeen.delete(actor);
    }
    return this.lastSeen.size;
  }
}

// ─── One scope ──────────────────────────────────────────────────────────────

/** The counters of one minute of one scope. */
class MinuteCounters {
  requests = 0;
  errors4xx = 0;
  errors5xx = 0;
  pageViews = 0;
  toolUses = 0;
  readonly latency = new LatencyHistogram();

  constructor(readonly minuteStartMs: number) {}
}

const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;
const LATENCY_KIND: ServerEventKind = 'http';

/** One scope (all apps, or one app): the current minute + presence. */
class ScopeWindow {
  private counters: MinuteCounters;
  private readonly presence = new ActivePresence();

  constructor(
    private readonly scope: string,
    nowMs: number,
  ) {
    this.counters = new MinuteCounters(minuteStartOf(nowMs));
  }

  recordApiRequest(sample: LiveApiSample, atMs: number): void {
    const counters = this.current(atMs);
    counters.requests += 1;
    if (sample.statusCode >= SERVER_ERROR_MIN) counters.errors5xx += 1;
    else if (sample.statusCode >= CLIENT_ERROR_MIN) counters.errors4xx += 1;
    if (sample.kind === LATENCY_KIND) counters.latency.record(sample.durationMs);
    if (sample.actor) this.presence.see(sample.actor, atMs);
  }

  recordWebEvent(sample: LiveWebSample, atMs: number): void {
    const counters = this.current(atMs);
    if (sample.eventType === 'page_view') counters.pageViews += 1;
    if (sample.eventType === 'tool_use') counters.toolUses += 1;
    if (sample.actor) this.presence.see(sample.actor, atMs);
  }

  tick(nowMs: number): LiveTickDto {
    const counters = this.current(nowMs);
    return {
      scope: this.scope,
      minute: new Date(counters.minuteStartMs).toISOString(),
      requests: counters.requests,
      errors4xx: counters.errors4xx,
      errors5xx: counters.errors5xx,
      p95Ms: roundOrNull(counters.latency.percentile(P95)),
      pageViews: counters.pageViews,
      toolUses: counters.toolUses,
      activeUsers: this.presence.count(nowMs),
    };
  }

  /** The counters of the minute containing `atMs` — a new minute starts from zero (rollover). */
  private current(atMs: number): MinuteCounters {
    const minuteStartMs = minuteStartOf(atMs);
    if (minuteStartMs > this.counters.minuteStartMs)
      this.counters = new MinuteCounters(minuteStartMs);
    return this.counters;
  }
}

/** Same minute boundaries as the SQL minute buckets (IST-aligned date_bin). */
function minuteStartOf(atMs: number): number {
  return bucketStartOf(new Date(atMs), 'minute').getTime();
}

// ─── The window ─────────────────────────────────────────────────────────────

/** What the live window needs from one committed API call. */
export interface LiveApiSample {
  kind: ServerEventKind;
  statusCode: number;
  durationMs: number;
  /** Actor key (user or session), null when the call carries neither. */
  actor: string | null;
}

/** What the live window needs from one committed browser event. */
export interface LiveWebSample {
  eventType: BrowserEventType;
  actor: string | null;
}

/** WHY: records every committed event into the "all" scope AND its app's scope; ticks read them. */
export class LiveWindow {
  private readonly scopes = new Map<string, ScopeWindow>();

  recordApiRequest(appSlug: string, sample: LiveApiSample, at: Date): void {
    for (const scope of scopesOf(appSlug))
      this.scopeAt(scope, at).recordApiRequest(sample, at.getTime());
  }

  recordWebEvent(appSlug: string, sample: LiveWebSample, at: Date): void {
    for (const scope of scopesOf(appSlug))
      this.scopeAt(scope, at).recordWebEvent(sample, at.getTime());
  }

  /** Cumulative counts of the current minute for `scope` (liveScopeKey); zeros when it saw nothing. */
  tick(scope: string, at: Date): LiveTickDto {
    return this.scopeAt(scope, at).tick(at.getTime());
  }

  private scopeAt(scope: string, at: Date): ScopeWindow {
    let window = this.scopes.get(scope);
    if (!window) {
      window = new ScopeWindow(scope, at.getTime());
      this.scopes.set(scope, window);
    }
    return window;
  }
}

/** The scope keys one app's event counts towards. */
function scopesOf(appSlug: string): [string, string] {
  return [liveScopeKey({}), liveScopeKey({ app: appSlug })];
}
