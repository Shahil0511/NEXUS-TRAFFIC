/**
 * WHY: tracker state lives on `globalThis` under a registered Symbol, NOT in module scope.
 * `@nexus/react`, `@nexus/react/next` and `@nexus/react/early` are separate bundles, and bundlers
 * may load the CJS and the ESM build side by side (dual-package hazard). A module-level singleton
 * would then exist several times: the early header source, the tracker and `trackTool()` would
 * each see a different session and a different set of patches.
 *
 * `@2`: the shape changed in 1.1.0 (ADR 0011). A 1.0.0 bundle on the same page keeps its own state.
 */
import { SDK_BROWSER_SESSION_IDLE_MS } from '@nexus/shared/constants';

import type { HeaderSource } from './header-source';
import { browserSessionStorage } from './safe-storage';
import { SessionStore } from './session-store';
import type { SdkRemoteConfigWire } from './wire';

const STATE_KEY = Symbol.for('@nexus/react/state@2');

/** What the global state needs from a tracker (the BrowserTracker class implements it). */
export interface TrackerLike {
  /** `keyScope(publishableKey)` — the kill switch and remote config are per scope. */
  readonly keyScope: string;
  trackTool(tool: string, options?: unknown): void;
  trackEvent(name: string, options?: unknown): void;
  flush(): void;
  /** The current page view (also after it ended), or null before the first one. */
  currentView(): { id: string; sessionId: string } | null;
  /** Kill switch: stop sending and drop everything queued in memory. */
  disable(): void;
  /** The kill was lifted (a valid 200 config): capture again in this page. */
  enable(): void;
  /** Events waiting in memory (diagnostics). */
  queuedCount(): number;
}

export interface RegistryEntry<T> {
  tracker: T;
  refs: number;
  stopTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface FetchPatchState {
  original: typeof fetch;
  patched: typeof fetch;
}

export interface XhrMethods {
  open: XMLHttpRequest['open'];
  send: XMLHttpRequest['send'];
  setRequestHeader: XMLHttpRequest['setRequestHeader'];
}

export interface XhrPatchState {
  proto: XhrMethods;
  original: XhrMethods;
  patched: XhrMethods;
}

/** SDK-local diagnostics, read by `getNexusStats()` (ADR 0012: wire reporting is future work). */
export interface NexusCounters {
  droppedOverflow: number;
  persisted: number;
  persistFailed: number;
  replayed: number;
  expired: number;
  droppedReplayCap: number;
}

export interface NexusGlobalState {
  trackers: Map<string, RegistryEntry<TrackerLike>>;
  /** The most recently started tracker; `trackTool()` / `trackEvent()` go here. */
  active: TrackerLike | undefined;
  /** Every source of propagated headers; the NEWEST allowed one decorates. */
  headerSources: Set<HeaderSource>;
  fetchPatch: FetchPatchState | null;
  xhrPatch: XhrPatchState | null;
  /** `fetch` captured BEFORE any patch — the only fetch ingest and config requests use. */
  nativeFetch: typeof fetch | null;
  /** The ONE session store of the page (early headers and the tracker share it). */
  session: SessionStore | null;
  /** Pre-allocated by the early entry; the tracker's first `load` page view takes it as eventId. */
  pendingPageViewId: string | null;
  earlySource: HeaderSource | null;
  /** Key scopes killed in this page (kill switch). */
  disabledKeys: Set<string>;
  /** The applied remote config per key scope. */
  remote: Map<string, SdkRemoteConfigWire>;
  counters: NexusCounters;
}

export function globalState(): NexusGlobalState {
  const holder = globalThis as unknown as Record<symbol, NexusGlobalState | undefined>;
  let state = holder[STATE_KEY];
  if (!state) {
    state = {
      trackers: new Map(),
      active: undefined,
      headerSources: new Set(),
      fetchPatch: null,
      xhrPatch: null,
      nativeFetch: null,
      session: null,
      pendingPageViewId: null,
      earlySource: null,
      disabledKeys: new Set(),
      remote: new Map(),
      counters: {
        droppedOverflow: 0,
        persisted: 0,
        persistFailed: 0,
        replayed: 0,
        expired: 0,
        droppedReplayCap: 0,
      },
    };
    holder[STATE_KEY] = state;
  }
  return state;
}

/**
 * WHY: ONE `SafeStorage(sessionStorage)` and ONE `SessionStore` per page. With storage blocked,
 * SafeStorage falls back to memory — two instances would hand out two different session ids.
 */
export function sharedSessionStore(): SessionStore {
  const state = globalState();
  state.session ??= new SessionStore(browserSessionStorage(), SDK_BROWSER_SESSION_IDLE_MS);
  return state.session;
}

type MaybePatchedFetch = typeof fetch & { __nexusOriginal?: typeof fetch };

/**
 * WHY: ingest and config requests must never pass through a host interceptor (one that adds an
 * Authorization header, logs bodies, …). Capture the real fetch ONCE, before our own patch is
 * installed — so it must be called before `installFetchPatch()`.
 */
export function captureNativeFetch(): void {
  const state = globalState();
  if (state.nativeFetch) return;
  const current = (globalThis as { fetch?: MaybePatchedFetch }).fetch;
  if (typeof current !== 'function') return;
  state.nativeFetch = current.__nexusOriginal ?? current;
}
