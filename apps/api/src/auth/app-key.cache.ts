/**
 * Bounded LRU cache of authenticated keys, keyed by key PREFIX (never by the full secret),
 * TTL 30 s. Admin mutations call invalidateApp() directly (single api process).
 */
import type { AuthenticatedKey } from '../domain/viewer';
import type { Clock } from '../lib/clock';
import { notImplemented } from '../lib/not-implemented';

export class AppKeyCache {
  constructor(
    private readonly clock: Clock,
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 1000,
  ) {}

  get(keyPrefix: string): AuthenticatedKey | undefined {
    void keyPrefix;
    void this.clock;
    void this.ttlMs;
    void this.maxEntries;
    throw notImplemented('AppKeyCache.get');
  }

  set(keyPrefix: string, value: AuthenticatedKey): void {
    void keyPrefix;
    void value;
    throw notImplemented('AppKeyCache.set');
  }

  invalidateApp(appId: string): void {
    void appId;
    throw notImplemented('AppKeyCache.invalidateApp');
  }
}
