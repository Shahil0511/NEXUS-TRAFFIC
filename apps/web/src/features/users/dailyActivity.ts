/**
 * Pure helpers of the person page's "Daily activity" tab: where a day's activity sits on the
 * 00:00-24:00 IST strip, and the window totals (days active, average first / last activity, total
 * active time).
 *
 * WHY HERE: the arithmetic is the part that can be wrong silently (a strip drawn an hour off, an
 * average that mixes days), so it lives outside the components and is unit-tested.
 * Every `day` is the instant of an IST midnight (UserDayActivityDto.day), so "time into the day"
 * is a plain subtraction — no time-zone maths in the browser.
 */
import type { UserDayActivityDto } from '@nexus/shared';

export const DAY_MS = 86_400_000;
const PERCENT = 100;
/** A one-event day still gets a visible mark on the strip (in % of the day). */
export const MIN_STRIP_WIDTH_PCT = 0.75;

/** A span on the day strip, in % of 24 hours from the left edge (00:00 IST). */
export interface DayStripSpan {
  startPct: number;
  widthPct: number;
}

/** Milliseconds from the IST midnight `day` to `at`, clamped to the day [0, DAY_MS]. */
export function msIntoDay(day: string, at: string): number {
  const offset = Date.parse(at) - Date.parse(day);
  return Math.min(DAY_MS, Math.max(0, offset));
}

/**
 * Where the span from the first to the last activity of a day sits on the strip. Never narrower
 * than MIN_STRIP_WIDTH_PCT and never past the right edge.
 */
export function dayStripSpan(day: string, firstAt: string, lastAt: string): DayStripSpan {
  const startPct = (msIntoDay(day, firstAt) / DAY_MS) * PERCENT;
  const endPct = (msIntoDay(day, lastAt) / DAY_MS) * PERCENT;
  const widthPct = Math.max(endPct - startPct, MIN_STRIP_WIDTH_PCT);
  return { startPct: Math.min(startPct, PERCENT - widthPct), widthPct };
}

/** The mean time of day (ms after IST midnight) of one instant per day; null without days. */
export function averageTimeIntoDay(
  days: readonly UserDayActivityDto[],
  pick: (day: UserDayActivityDto) => string,
): number | null {
  if (days.length === 0) return null;
  const sum = days.reduce((total, day) => total + msIntoDay(day.day, pick(day)), 0);
  return sum / days.length;
}

/** The totals row of the tab, over the active days of the window. */
export interface DailyTotals {
  daysActive: number;
  /** Mean first activity, ms after IST midnight (null without days). */
  averageFirstMs: number | null;
  /**
   * Mean last activity, ms after IST midnight, over the days that have ENDED (null without one):
   * the day still running (`inProgress`) only has a last activity "so far".
   */
  averageLastMs: number | null;
  /** Σ tab-visible time of every day. */
  totalActiveMs: number;
}

export function summarizeDays(days: readonly UserDayActivityDto[]): DailyTotals {
  return {
    daysActive: days.length,
    averageFirstMs: averageTimeIntoDay(days, (day) => day.firstActivityAt),
    averageLastMs: averageTimeIntoDay(
      days.filter((day) => !day.inProgress),
      (day) => day.lastActivityAt,
    ),
    totalActiveMs: days.reduce((total, day) => total + day.activeMs, 0),
  };
}
