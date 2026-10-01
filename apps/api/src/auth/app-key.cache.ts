/**
 * Bounded LRU cache of authenticated keys, keyed by key PREFIX (never by the full secret),
 * TTL 30 s. Admin mutations call invalidateApp() directly (single api process).
 *
 * NOTE: a hit is NOT proof of possession — the prefix is displayed in the dashboard. The
 * authenticator MUST still verify the full key against the cached hash.
 */
import type { AuthenticatedKey } from '../domain/viewer';
import type { Clock } from '../lib/clock';

interface CacheEntry {
  value: AuthenticatedKey;
  expiresAt: number;
}

/** WHY: saves two DB round trips per ingest request for hot keys without hiding revocations long. */
export class AppKeyCache {
  /** Map iteration order = insertion order, so the first key is always the least recently used. */
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 1000,
  ) {}

  get(keyPrefix: string): AuthenticatedKey | undefined {
    const entry = this.entries.get(keyPrefix);
    if (!entry) return undefined;
    this.entries.delete(keyPrefix);
    if (entry.expiresAt <= this.clock.now().getTime()) return undefined;
    this.entries.set(keyPrefix, entry);
    return entry.value;
  }

  set(keyPrefix: string, value: AuthenticatedKey): void {
    this.entries.delete(keyPrefix);
    this.entries.set(keyPrefix, { value, expiresAt: this.clock.now().getTime() + this.ttlMs });
    this.evictOverflow();
  }

  invalidateApp(appId: string): void {
    for (const [prefix, entry] of this.entries) {
      if (entry.value.app.id === appId) this.entries.delete(prefix);
    }
  }

  /** Current number of entries (expired ones included until touched). */
  get size(): number {
    return this.entries.size;
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
