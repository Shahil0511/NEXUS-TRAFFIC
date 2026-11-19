/**
 * Clean-up of OTHER key scopes' storage (ADR 0012).
 *
 * WHY: the persisted retry queue (`nexus.retry:<scope>`, plus `:claim`) and the cached config
 * (`nexus.config:<scope>`) of a scope are only pruned when a tracker of THAT scope reads them.
 * After a publishable-key rotation, or once an app leaves a shared origin, nobody reads them again,
 * and up to `retryQueueMaxBytes` per old scope would sit in the origin's shared quota forever.
 * Once per tracker start, this removes other scopes' entries that are past their own expiry:
 * - a retry queue whose NEWEST batch is older than `retryQueueTtlMs` (or that is unreadable);
 * - a claim record older than a minute (its tab died; the live tab re-claims within seconds);
 * - a config cache older than `configMaxStaleMs` (or unreadable).
 * The own scope is never touched here (its owner prunes it). Cheap prefix scan; NEVER throws.
 */
import { SDK_DEFAULTS } from '@nexus/shared/constants';

import { STORAGE_KEYS } from './sdk-info';

const RETRY_PREFIX = `${STORAGE_KEYS.retryQueue}:`;
const CONFIG_PREFIX = `${STORAGE_KEYS.config}:`;
const CLAIM_SUFFIX = ':claim';
/** Same staleness as the retry queue's claim record. */
const CLAIM_STALE_MS = 60_000;

export function pruneStaleScopes(
  ownScope: string,
  now: number = Date.now(),
  storage: Storage | undefined = browserLocalStorage(),
): void {
  try {
    if (!storage) return;
    for (const key of nexusKeys(storage)) {
      if (isStale(key, ownScope, storage.getItem(key), now)) storage.removeItem(key);
    }
  } catch {
    // never throw into the host app
  }
}

/** WHY: collect first — removing while iterating `storage.key(i)` would skip entries. */
function nexusKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && (key.startsWith(RETRY_PREFIX) || key.startsWith(CONFIG_PREFIX))) keys.push(key);
  }
  return keys;
}

function isStale(key: string, ownScope: string, raw: string | null, now: number): boolean {
  if (key.startsWith(CONFIG_PREFIX)) {
    if (key.slice(CONFIG_PREFIX.length) === ownScope) return false;
    return isOlderThan(readNumber(raw, 'at'), now, SDK_DEFAULTS.browser.configMaxStaleMs);
  }
  const rest = key.slice(RETRY_PREFIX.length);
  if (rest.endsWith(CLAIM_SUFFIX)) {
    if (rest.slice(0, -CLAIM_SUFFIX.length) === ownScope) return false;
    return isOlderThan(readNumber(raw, 'at'), now, CLAIM_STALE_MS);
  }
  if (rest === ownScope) return false;
  return isOlderThan(newestOccurredAt(raw), now, SDK_DEFAULTS.browser.retryQueueTtlMs);
}

/** WHY: unreadable (undefined) counts as stale — nobody can use it. */
function isOlderThan(at: number | undefined, now: number, maxAgeMs: number): boolean {
  return at === undefined || now - at > maxAgeMs;
}

function readNumber(raw: string | null, field: string): number | undefined {
  try {
    const value = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    const n = value?.[field];
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/** The newest `occurredAt` of any event of any persisted batch. */
function newestOccurredAt(raw: string | null): number | undefined {
  try {
    const entries = JSON.parse(raw ?? 'null') as unknown;
    if (!Array.isArray(entries)) return undefined;
    let newest: number | undefined;
    for (const entry of entries) {
      const events = (entry as { envelope?: { events?: unknown } } | null)?.envelope?.events;
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        const at = Date.parse(String((event as { occurredAt?: unknown } | null)?.occurredAt));
        if (Number.isFinite(at) && (newest === undefined || at > newest)) newest = at;
      }
    }
    return newest;
  } catch {
    return undefined;
  }
}

/** WHY: accessing `window.localStorage` can itself throw (sandboxed iframe, blocked cookies). */
function browserLocalStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
