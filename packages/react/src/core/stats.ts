/**
 * `getNexusStats()` — SDK-local delivery diagnostics (ADR 0012).
 *
 * WHY: the retry queue and the kill switch work silently; this lets a developer check them from
 * the browser console. Counters live in the global state, so every bundle reports the same numbers.
 */
import { globalState, type NexusCounters } from './global-state';

export interface NexusStats {
  /** Events waiting in memory, not yet sent. */
  queued: number;
  /** Events or persisted batches dropped because a bound was reached. */
  droppedOverflow: number;
  /** Failed batches saved to localStorage for the next page load. */
  persisted: number;
  /** Saves that failed (quota, blocked storage) — those batches are lost. */
  persistFailed: number;
  /** Persisted batches delivered on a later page load. */
  replayed: number;
  /** Persisted batches dropped by age (24 h). */
  expired: number;
  /** Persisted batches dropped after 3 page loads without delivery. */
  droppedReplayCap: number;
  /** Version of the applied remote config, null when none. */
  configVersion: number | null;
  /** True when the kill switch is active for the current key. */
  disabled: boolean;
}

/** WHY: one place increments the counters (never throws). */
export function countStat(name: keyof NexusCounters, by = 1): void {
  try {
    globalState().counters[name] += by;
  } catch {
    // diagnostics only
  }
}

/** A snapshot of the delivery counters of this page. NEVER throws. */
export function getNexusStats(): NexusStats {
  try {
    const state = globalState();
    let queued = 0;
    for (const entry of state.trackers.values()) queued += entry.tracker.queuedCount();
    const scope = state.active?.keyScope ?? state.earlySource?.keyScope;
    return {
      queued,
      ...state.counters,
      configVersion: scope === undefined ? null : (state.remote.get(scope)?.version ?? null),
      disabled: scope === undefined ? false : state.disabledKeys.has(scope),
    };
  } catch {
    return {
      queued: 0,
      droppedOverflow: 0,
      persisted: 0,
      persistFailed: 0,
      replayed: 0,
      expired: 0,
      droppedReplayCap: 0,
      configVersion: null,
      disabled: false,
    };
  }
}
