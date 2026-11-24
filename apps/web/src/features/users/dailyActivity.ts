/**
 * Pure helpers of the person page's "Daily activity" tab: where a day's activity sits on the
 * 00:00-24:00 IST strip, the window totals (active days, average first / last activity, tab
 * visible time) and the one-day link query of a row's Visits count.
 *
 * WHY HERE: the arithmetic is the part that can be wrong silently (a strip drawn an hour off, an
 * average that mixes days), so it lives outside the components and is unit-tested.
 * Every `day` is the instant of an IST midnight (UserDayActivityDto.day), so "time into the day"
 * is a plain subtraction — no time-zone maths in the browser.
 */
import type { UserDayActivityDto } from '@nexus/shared';

import { EMPTY_VALUE, formatClockOffset, formatInteger, withUnit } from '@/lib/format';

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
  activeDays: number;
  /** Mean first activity, ms after IST midnight (null without days). */
  averageFirstMs: number | null;
  /**
   * Mean last activity, ms after IST midnight, over the days that have ENDED (null without one):
   * the day still running (`inProgress`) only has a last activity "so far".
   */
  averageLastMs: number | null;
  /** Σ tab visible time of every day (UserDayActivityDto.activeMs). */
  totalTabVisibleMs: number;
}

export function summarizeDays(days: readonly UserDayActivityDto[]): DailyTotals {
  return {
    activeDays: days.length,
    averageFirstMs: averageTimeIntoDay(days, (day) => day.firstActivityAt),
    averageLastMs: averageTimeIntoDay(
      days.filter((day) => !day.inProgress),
      (day) => day.lastActivityAt,
    ),
    totalTabVisibleMs: days.reduce((total, day) => total + day.activeMs, 0),
  };
}

/** What "Average last activity" shows while the only active day is today (still running). */
export const NOT_ENDED_YET = 'Not yet';

/**
 * The value of the "Average last activity" KPI: "16:00 IST"; NOT_ENDED_YET when every active day
 * is still running (today only — its last activity is "so far", so it is left out of the average);
 * "—" alone without any active day. Never "— IST". Pure.
 */
export function averageLastLabel(totals: DailyTotals): string {
  if (totals.averageLastMs === null) return totals.activeDays > 0 ? NOT_ENDED_YET : EMPTY_VALUE;
  return withUnit(formatClockOffset(totals.averageLastMs), 'IST');
}

/** A custom range of exactly one IST day: `from` = its midnight, `to` = 24 h later. */
export interface DayWindowQuery {
  range: 'custom';
  from: string;
  to: string;
}

/**
 * The global-filter range of ONE IST day, from the day's midnight instant (UserDayActivityDto.day)
 * to the next midnight (24 h later: India keeps no daylight saving). Pure.
 */
export function dayWindowQuery(day: string): DayWindowQuery {
  const fromMs = Date.parse(day);
  return {
    range: 'custom',
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + DAY_MS).toISOString(),
  };
}

/**
 * The query of the Visits page narrowed to this person and this ONE day, keeping the current app
 * and environment of `base` (filterLinkQuery). WHY a custom range: with the global range, a row of
 * an older day would open the Visits of the whole range, not of that day. The person narrowing
 * (`?userKey=`) is admin-only on the API and recorded in the access log (`person_visits`). Pure.
 */
export function dayVisitsQuery(
  day: string,
  base: Readonly<Record<string, string | undefined>>,
  userKey: string,
): Record<string, string | undefined> {
  return { app: base.app, env: base.env, userKey, ...dayWindowQuery(day) };
}

/** "1 page view", "38 page views", "1,234 API calls": a count with its noun. Pure. */
export function countLabel(count: number, one: string, many: string): string {
  return `${formatInteger(count)} ${count === 1 ? one : many}`;
}
