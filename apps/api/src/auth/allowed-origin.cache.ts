/**
 * Bounded LRU cache of "does SOME app allow this Origin?", keyed by the lower-cased origin, TTL 30 s,
 * negatives cached too. Two instances, one per rule (container.ts):
 * - `browser-enabled` (AppRepository.anyAllowsOrigin — an ACTIVE app with browser ingest ON lists it):
 *   gates the CORS preflight;
 * - `registered` (AppRepository.anyListsOrigin — ANY app lists it): gates the pre-auth early CORS of
 *   every beacon and config poll (ADR 0009). It must ignore is_active / browser_ingest_enabled, or a
 *   killed app's own origin would get an unreadable (CORS-blocked) 403 and the SDK kill never trips.
 *
 * WHY: without a cache each beacon would add a DB query; with it, an admin change to
 * allowed_origins takes effect within 30 s — the same lag as AppKeyCache.
 * NOTE: this only decides whether responses are READABLE cross-origin; originGuard (per app, after
 * auth) still decides whether a beacon is accepted.
 * @see ../repositories/app.repository.ts AppRepository.anyAllowsOrigin / anyListsOrigin
 */
import type { Clock } from '../lib/clock';
import type { AppRepository } from '../repositories/app.repository';

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

export const ALLOWED_ORIGIN_TTL_MS = 30_000;
export const ALLOWED_ORIGIN_MAX_ENTRIES = 500;

/** WHICH apps count: active + browser-enabled ones (preflight) or any registered app (early CORS). */
export type AllowedOriginRule = 'browser-enabled' | 'registered';

/** WHY: one DB answer per origin per 30 s, however many beacons ask. */
export class AllowedOriginCache {
  /** Map iteration order = insertion order, so the first key is always the least recently used. */
  private readonly entries = new Map<string, CacheEntry>();
  /** WHY: a burst of beacons from one new origin shares ONE repository query (no thundering herd). */
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly apps: AppRepository,
    private readonly clock: Clock,
    private readonly rule: AllowedOriginRule = 'browser-enabled',
    private readonly ttlMs = ALLOWED_ORIGIN_TTL_MS,
    private readonly maxEntries = ALLOWED_ORIGIN_MAX_ENTRIES,
  ) {}

  /** True when some app matching this cache's rule lists `origin` in allowed_origins. */
  async allows(origin: string): Promise<boolean> {
    const key = origin.replace(/\/$/, '').toLowerCase();
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    return this.inFlight.get(key) ?? this.load(key);
  }

  /** Current number of entries (expired ones included until touched). */
  get size(): number {
    return this.entries.size;
  }

  /** WHY: a failed lookup is not cached — the next request asks again (callers treat it as not allowed). */
  private load(key: string): Promise<boolean> {
    const pending = this.lookup(key)
      .then((allowed) => {
        this.set(key, allowed);
        return allowed;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private lookup(key: string): Promise<boolean> {
    return this.rule === 'registered' ? this.apps.anyListsOrigin(key) : this.apps.anyAllowsOrigin(key);
  }

  private get(key: string): boolean | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.clock.now().getTime()) return undefined;
    this.entries.set(key, entry);
    return entry.allowed;
  }

  private set(key: string, allowed: boolean): void {
    this.entries.delete(key);
    this.entries.set(key, { allowed, expiresAt: this.clock.now().getTime() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
