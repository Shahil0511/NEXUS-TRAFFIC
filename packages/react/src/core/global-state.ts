/**
 * WHY: tracker state lives on `globalThis` under a registered Symbol, NOT in module scope.
 * `@nexus/react` and `@nexus/react/next` are separate bundles, and bundlers may load the CJS and
 * the ESM build side by side (dual-package hazard). A module-level singleton would then exist
 * twice and `trackTool()` would talk to a tracker that was never started.
 */
const STATE_KEY = Symbol.for('@nexus/react/state');

export interface TrackerLike {
  trackTool(tool: string, options?: unknown): void;
  trackEvent(name: string, options?: unknown): void;
  flush(): void;
}

export interface RegistryEntry<T> {
  tracker: T;
  refs: number;
  stopTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface FetchPatchState {
  original: typeof fetch | undefined;
  patched: typeof fetch | undefined;
  sources: Set<unknown>;
}

export interface NexusGlobalState {
  trackers: Map<string, RegistryEntry<unknown>>;
  /** The most recently started tracker; `trackTool()` / `trackEvent()` go here. */
  active: TrackerLike | undefined;
  fetchPatch: FetchPatchState;
}

export function globalState(): NexusGlobalState {
  const holder = globalThis as unknown as Record<symbol, NexusGlobalState | undefined>;
  let state = holder[STATE_KEY];
  if (!state) {
    state = {
      trackers: new Map(),
      active: undefined,
      fetchPatch: { original: undefined, patched: undefined, sources: new Set() },
    };
    holder[STATE_KEY] = state;
  }
  return state;
}
