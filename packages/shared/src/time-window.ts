/**
 * Resolve a dashboard time query into a concrete window + bucket grain.
 *
 * WHY: one pure function used by every API analytics service (and unit-tested once), so the
 * Overview, Routes and Errors pages always agree on what "24h" means and which bucket size a
 * chart uses. The previous window (same length, immediately before) feeds KPI deltas.
 */
import {
  GRAIN_RULES,
  MAX_COUNT_RANGE_MS,
  RANGE_DURATIONS_MS,
  type Grain,
  type RangePreset,
} from './constants/time';

export interface TimeWindowInput {
  range: RangePreset;
  from?: string;
  to?: string;
}

export interface ResolvedTimeWindow {
  from: Date;
  to: Date;
  grain: Grain;
  previousFrom: Date;
  previousTo: Date;
  durationMs: number;
}

export class TimeWindowError extends Error {}

/** Bucket grain for a window length. */
export function grainFor(durationMs: number): Grain {
  const rule = GRAIN_RULES.find((r) => durationMs <= r.maxRangeMs);
  return rule ? rule.grain : 'day';
}

export function resolveTimeWindow(
  input: TimeWindowInput,
  now: Date,
  maxRangeMs: number = MAX_COUNT_RANGE_MS,
): ResolvedTimeWindow {
  const { from, to } = boundsFor(input, now);
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) throw new TimeWindowError('"from" must be before "to"');
  if (durationMs > maxRangeMs) {
    throw new TimeWindowError(`range too large (max ${Math.round(maxRangeMs / 86_400_000)} days)`);
  }
  return {
    from,
    to,
    grain: grainFor(durationMs),
    previousFrom: new Date(from.getTime() - durationMs),
    previousTo: from,
    durationMs,
  };
}

function boundsFor(input: TimeWindowInput, now: Date): { from: Date; to: Date } {
  if (input.range === 'custom') {
    if (!input.from || !input.to) throw new TimeWindowError('range=custom requires from and to');
    return { from: new Date(input.from), to: new Date(input.to) };
  }
  return { from: new Date(now.getTime() - RANGE_DURATIONS_MS[input.range]), to: now };
}
