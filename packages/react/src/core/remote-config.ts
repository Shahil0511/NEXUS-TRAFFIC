/**
 * Remote config client — POST ROUTES.ingest.config (ADR 0009).
 *
 * FAILURE BEHAVIOUR: capture fails OPEN, a known kill is honoured.
 * 1. The cache is applied synchronously at start (`applyCachedConfig`), younger than 24 h only.
 * 2. The network is asked only when the cache is older than `maxAgeMs` (or the recheck interval
 *    after a kill) AND this page has not asked within `maxAgeMs`, with the CAPTURED native fetch,
 *    `credentials: 'omit'` and a timeout that covers the response BODY too (a stalled body can
 *    never leave the refresh pending forever).
 * 3. A valid 200 whose version is not older than the cached one → stored and applied; when this
 *    key was killed in the page, the kill is LIFTED (`applyEnabledForScope`: trackers re-arm).
 * 4. An invalid body, a network error, an opaque response, 5xx or 429 → nothing changes.
 * 5. 401/403 with an SDK_KILL_ERROR_CODES code → the kill switch, in this page.
 * Remote config can only DISABLE modules; it never enables anything.
 */
import { SDK_DEFAULTS } from '@nexus/shared/constants';

import {
  parseRemoteConfig,
  readCachedConfig,
  writeCachedConfig,
  type CachedConfig,
} from './config-cache';
import { globalState } from './global-state';
import { resolveConfigUrl } from './ingest-urls';
import { applyDisabledForScope, applyEnabledForScope } from './kill';
import { keyScope } from './sdk-info';
import { CONTENT_TYPE, isKillCode, readErrorCode } from './transport';
import type { SdkConfigWireRequest } from './wire';

export { parseRemoteConfig } from './config-cache';

/**
 * WHY: the synchronous half — called before anything is captured. Returns false when the cache
 * says this key is killed (the caller then stays disabled for this page).
 */
export function applyCachedConfig(scope: string, now: number = Date.now()): boolean {
  const cached = readCachedConfig(scope, now);
  const state = globalState();
  if (cached?.config) state.remote.set(scope, cached.config);
  if (cached && !cached.enabled) {
    state.disabledKeys.add(scope);
    return false;
  }
  return !state.disabledKeys.has(scope);
}

/** WHY: is the network worth asking? (a kill is re-checked less often than a normal config) */
export function isRefreshDue(cached: CachedConfig | null, now: number): boolean {
  if (!cached) return true;
  if (!cached.enabled) return now - cached.at >= SDK_DEFAULTS.browser.disabledRecheckMs;
  const maxAge = cached.config?.maxAgeMs ?? SDK_DEFAULTS.browser.configMaxAgeMs;
  return now - cached.at >= maxAge;
}

/** What the config request answered, with the body already read (within the timeout). */
interface ConfigAnswer {
  status: number;
  /** The parsed JSON of a 200 (null when unreadable). */
  json: unknown;
  /** The `error.code` of a 401 / 403. */
  errorCode: string | undefined;
}

/** WHY: hard ceiling of one refresh — the abort timer plus a margin for a fetch that ignores it. */
const REFRESH_DEADLINE_MS = SDK_DEFAULTS.browser.configTimeoutMs * 2;

export class RemoteConfigClient {
  private inFlight: Promise<void> | null = null;
  /**
   * WHY: the cache only moves on a valid answer. Without this in-memory floor, a failing collector
   * (5xx, 429, network/opaque), blocked localStorage or a version regression would make every tab
   * POST the config endpoint on EVERY flush tick (5 s) instead of once per `maxAgeMs`.
   */
  private nextAttemptAt = 0;

  /**
   * WHY: one request at a time; resolves when done or after REFRESH_DEADLINE_MS, whichever comes
   * first (never rejects) — so callers chained on it (the retry-queue drain) always run.
   */
  refresh(url: string, key: string, client: SdkConfigWireRequest['client']): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = withDeadline(this.fetchConfig(url, key, client), REFRESH_DEADLINE_MS).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async fetchConfig(
    url: string,
    key: string,
    client: SdkConfigWireRequest['client'],
  ): Promise<void> {
    try {
      const scope = keyScope(key);
      const now = Date.now();
      const cached = readCachedConfig(scope, now);
      if (!isRefreshDue(cached, now) || now < this.nextAttemptAt) return;
      this.nextAttemptAt = now + (cached?.config?.maxAgeMs ?? SDK_DEFAULTS.browser.configMaxAgeMs);
      const answer = await this.post(resolveConfigUrl(url), { key, ...(client ? { client } : {}) });
      if (!answer) return;
      if (answer.status === 200) {
        this.accept(scope, cached, answer.json);
        return;
      }
      if (answer.status === 401 || answer.status === 403) {
        if (isKillCode(answer.errorCode)) applyDisabledForScope(scope);
      }
      // 5xx, 429 and everything else: keep the current state.
    } catch {
      // fail open
    }
  }

  /**
   * WHY: the captured native fetch, so no host interceptor ever sees the key. The abort timer runs
   * until the BODY is read: headers that arrive followed by a stalled body still time out.
   * Null for a network error, a timeout or an opaque / status-0 response.
   */
  private async post(configUrl: string, body: SdkConfigWireRequest): Promise<ConfigAnswer | null> {
    const fetchFn = globalState().nativeFetch;
    if (!fetchFn) return null;
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const timer = setTimeout(() => controller?.abort(), SDK_DEFAULTS.browser.configTimeoutMs);
    try {
      const response = await fetchFn.call(globalThis, configUrl, {
        method: 'POST',
        body: JSON.stringify(body),
        credentials: 'omit',
        headers: { 'Content-Type': CONTENT_TYPE },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (response.type === 'opaque' || response.status === 0) return null;
      const isAuthError = response.status === 401 || response.status === 403;
      return {
        status: response.status,
        json: response.status === 200 ? await readJson(response) : null,
        errorCode: isAuthError ? await readErrorCode(response) : undefined,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** WHY: invalid → ignored; older than the cached version → ignored; `enabled: false` → kill. */
  private accept(scope: string, cached: CachedConfig | null, json: unknown): void {
    const config = parseRemoteConfig(json);
    if (!config) return;
    if (cached?.config && config.version < cached.config.version) return;
    if (!config.enabled) {
      applyDisabledForScope(scope);
      return;
    }
    writeCachedConfig(scope, { at: Date.now(), enabled: true, config });
    globalState().remote.set(scope, config);
    applyEnabledForScope(scope);
  }
}

/** WHY: resolves when `work` settles or after `ms`, whichever is first; never rejects. */
function withDeadline(work: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
