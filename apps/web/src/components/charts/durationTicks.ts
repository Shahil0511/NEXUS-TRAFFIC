const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** At most this many steps above 0 on a time-length value axis (so at most 5 labels). */
const MAX_TICK_STEPS = 4;

/** "Nice" steps of a time-length axis, smallest first: whole minutes, then whole hours. */
const TICK_STEPS_MS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map(
  (minutes) => minutes * MS_PER_MINUTE,
);

/** The smallest nice step that reaches `maxMs` in MAX_TICK_STEPS steps (whole days beyond 4 d). */
function durationTickStep(maxMs: number): number {
  const step = TICK_STEPS_MS.find((candidate) => candidate * MAX_TICK_STEPS >= maxMs);
  if (step !== undefined) return step;
  const day = 24 * MS_PER_HOUR;
  return Math.ceil(maxMs / MAX_TICK_STEPS / day) * day;
}

/**
 * WHY: value-axis ticks for lengths of time (ms), chosen from the data's largest value so every
 * tick is a whole number of minutes and no two labels read the same. Rounding evenly spaced
 * ticks to 0.1 h printed "0.1h" three times on a day of a few minutes. Always starts at 0 and
 * ends at the first tick at or above the max; no data (or only 0) gives 0 and 1 minute.
 * @see formatHoursMinutesShort in lib/format.ts — the label of each tick ("0", "5m", "1h 30m").
 */
export function durationTicks(maxMs: number): number[] {
  const top = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : MS_PER_MINUTE;
  const step = durationTickStep(top);
  const count = Math.ceil(top / step);
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

