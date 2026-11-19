/**
 * The kill switch, applied IN THE CURRENT PAGE (ADR 0009 / 0011 / 0012).
 *
 * WHY: an admin who turns browser capture off expects it to stop now, not at the next deploy.
 * When the config endpoint or an ingest response carries an SDK_KILL_ERROR_CODES code, every
 * part of the SDK for that key scope stops: trackers, the persisted retry queue, header
 * propagation (the patches are removed if still ours) — and the next page load starts disabled
 * from the cache. NEVER throws.
 *
 * LIFTING: a later valid 200 from the config endpoint (`RemoteConfigClient.accept`, the trackers
 * re-check every `disabledRecheckMs` while killed) calls `applyEnabledForScope`: the scope leaves
 * `disabledKeys` and every tracker of it re-arms in the SAME page — a long-lived SPA tab is not
 * invisible until a hard reload.
 */
import { readCachedConfig, writeCachedConfig } from './config-cache';
import { installFetchPatch, releaseFetchPatchIfOurs } from './fetch-patch';
import { globalState } from './global-state';
import { RetryStorage } from './retry-storage';
import { STORAGE_KEYS } from './sdk-info';
import { installXhrPatch, releaseXhrPatchIfOurs } from './xhr-patch';

export function applyDisabledForScope(keyScope: string): void {
  try {
    const state = globalState();
    state.disabledKeys.add(keyScope);
    for (const entry of state.trackers.values()) {
      if (entry.tracker.keyScope === keyScope) entry.tracker.disable();
    }
    new RetryStorage().remove(`${STORAGE_KEYS.retryQueue}:${keyScope}`);
    const now = Date.now();
    writeCachedConfig(keyScope, {
      at: now,
      enabled: false,
      config: readCachedConfig(keyScope, now)?.config ?? null,
    });
    if (!hasLiveHeaderSource()) {
      releaseFetchPatchIfOurs();
      releaseXhrPatchIfOurs();
    }
  } catch {
    // never throw into the host app
  }
}

/** WHY: the kill was lifted — re-arm this scope's trackers (and the early header source). */
export function applyEnabledForScope(keyScope: string): void {
  try {
    const state = globalState();
    if (!state.disabledKeys.delete(keyScope)) return;
    for (const entry of state.trackers.values()) {
      if (entry.tracker.keyScope === keyScope) entry.tracker.enable();
    }
    if (state.earlySource?.keyScope === keyScope) {
      installFetchPatch();
      installXhrPatch();
    }
  } catch {
    // never throw into the host app
  }
}

/** WHY: the patches stay while ANY non-disabled source (another key, another tracker) needs them. */
function hasLiveHeaderSource(): boolean {
  const state = globalState();
  for (const source of state.headerSources) {
    if (!state.disabledKeys.has(source.keyScope)) return true;
  }
  return false;
}
