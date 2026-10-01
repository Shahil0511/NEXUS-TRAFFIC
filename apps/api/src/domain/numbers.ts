/**
 * Number formatting rules shared by every analytics DTO.
 *
 * WHY: percentiles and averages come out of PostgreSQL as float8 with long binary tails
 * (41.70000076293945); rounding once, here, keeps JSON stable and charts free of noise. Precision is
 * deliberately coarse: dashboards show milliseconds and percentages, not micro-units.
 */

/** Decimal places of latency values (ms) and percentages in DTOs. */
export const DTO_DECIMALS = 2;

/** Round half away from zero to `digits` decimals (never returns -0). */
export function roundTo(value: number, digits: number = DTO_DECIMALS): number {
  const factor = 10 ** digits;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 && magnitude !== 0 ? -magnitude : magnitude;
}

/** Like roundTo, for nullable aggregates (percentile_cont over zero rows is NULL). */
export function roundOrNull(value: number | null, digits: number = DTO_DECIMALS): number | null {
  return value === null ? null : roundTo(value, digits);
}

/** `part / whole * 100`, rounded; null when `whole` is 0 (a rate over nothing is undefined). */
export function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : roundTo((part / whole) * 100);
}
