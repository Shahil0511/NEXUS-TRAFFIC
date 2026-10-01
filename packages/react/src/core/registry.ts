/**
 * One tracker per (ingest URL, key), shared by every component that mounts the hook.
 *
 * WHY
 * - React StrictMode mounts, unmounts and re-mounts effects in development. Stopping immediately
 *   would send a bogus final `page_time` and a second `page_view`; the stop is therefore DEFERRED
 *   one macrotask and cancelled if the tracker is re-acquired.
 * - `trackTool()` / `trackEvent()` are plain functions (usable outside components), so the most
 *   recently acquired tracker is the "active" one.
 */
import { buildIngestUrl } from '@nexus/shared/ingest/build-ingest-url';
import { ROUTES } from '@nexus/shared/routes';

import { BrowserTracker, type BrowserTrackerConfig } from './browser-tracker';
import { globalState, type RegistryEntry } from './global-state';

/**
 * WHY: teams pass NEXUS_URL (e.g. `https://nexus.libas.in/traffic`); the endpoint is derived with
 * the same `buildIngestUrl` rule as every other SDK. A full ingest URL is accepted unchanged.
 */
export function resolveIngestUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const suffix = `/api${ROUTES.ingest.browser.path}`;
  return trimmed.endsWith(suffix) ? trimmed : buildIngestUrl(trimmed, ROUTES.ingest.browser);
}

/** WHY: acquire = create-or-reuse + refcount; returns the release function. */
export function acquireTracker(
  config: BrowserTrackerConfig,
): { tracker: BrowserTracker; release: () => void } {
  const state = globalState();
  const id = `${config.ingestUrl}|${config.publishableKey}`;
  let entry = state.trackers.get(id) as RegistryEntry<BrowserTracker> | undefined;
  if (entry) {
    if (entry.stopTimer !== undefined) clearTimeout(entry.stopTimer);
    entry.stopTimer = undefined;
    entry.tracker.setOptions(config);
  } else {
    entry = { tracker: new BrowserTracker(config), refs: 0, stopTimer: undefined };
    state.trackers.set(id, entry as RegistryEntry<unknown>);
    entry.tracker.start();
  }
  entry.refs++;
  state.active = entry.tracker;
  const owned = entry;
  let released = false;
  return {
    tracker: owned.tracker,
    release: () => {
      if (released) return;
      released = true;
      releaseEntry(id, owned);
    },
  };
}

function releaseEntry(id: string, entry: RegistryEntry<BrowserTracker>): void {
  entry.refs--;
  if (entry.refs > 0) return;
  entry.stopTimer = setTimeout(() => {
    const state = globalState();
    if (entry.refs > 0 || state.trackers.get(id) !== entry) return;
    state.trackers.delete(id);
    entry.tracker.stop();
    if (state.active === entry.tracker) state.active = lastTracker();
  }, 0);
}

function lastTracker(): BrowserTracker | undefined {
  let last: BrowserTracker | undefined;
  for (const entry of globalState().trackers.values()) {
    last = (entry as RegistryEntry<BrowserTracker>).tracker;
  }
  return last;
}
