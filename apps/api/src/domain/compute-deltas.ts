/**
 * KPI deltas: a value over the selected window compared with the previous equal-length window
 * (see `resolveTimeWindow` in @nexus/shared, which yields `previousFrom/previousTo`).
 *
 * WHY: pure and in domain/ so every KPI card on every page computes "↑ 12 %" the same way, and the
 * null rules (no data before → no delta, never Infinity) are unit-tested once.
 */
import type { MetricDto } from '@nexus/shared';

import { roundOrNull } from './numbers';

/**
 * `deltaPct = (value - previous) / previous * 100`, null when either side is null or previous is 0.
 * Values are rounded to DTO precision.
 */
export function computeMetric(value: number | null, previous: number | null): MetricDto {
  const deltaPct =
    value === null || previous === null || previous === 0
      ? null
      : ((value - previous) / previous) * 100;
  return {
    value: roundOrNull(value),
    previous: roundOrNull(previous),
    deltaPct: roundOrNull(deltaPct),
  };
}
