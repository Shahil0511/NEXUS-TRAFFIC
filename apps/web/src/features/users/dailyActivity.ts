/**
 * Pure helpers of the person page's "Daily activity" tab: where a day's activity sits on the
 * 00:00-24:00 IST strip, the window totals (active days, average first / last activity, tab
 * visible time), the per-app lines of a day, the gap-filled points of the per-day chart and the
 * one-day link query of a row's Visits count; for the one-day view, its link, the previous / next
 * day, the visit-steps link of a visit and where each activity block sits on the day timeline; for
 * the usual-activity-hours grid, its 7 × 24 cells with their share and text.
 *
 * WHY HERE: the arithmetic is the part that can be wrong silently (a strip drawn an hour off, an
 * average that mixes days), so it lives outside the components and is unit-tested.
 * Every `day` is the instant of an IST midnight (UserDayActivityDto.day), so "time into the day"
 * is a plain subtraction — no time-zone maths in the browser.
 */
import {
  addReportingDays,
  reportingDayOf,
  USER_DAY_LOOKBACK_DAYS,
  type UserActivityBlockDto,
  type UserActivityPatternDto,
  type UserDayActivityDto,
  type UserDayAppActivityDto,
} from '@nexus/shared';

import {
  EMPTY_VALUE,
  formatClockOffset,
  formatClockTime,
  formatHoursMinutes,
  formatInteger,
  withUnit,
} from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

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

// ─── Per-app lines of a day ─────────────────────────────────────────────────

/** App lines per day row before "+N more": a day rarely touches more apps. */
export const DAY_APP_LINES_SHOWN = 3;

/** The app lines a day row shows first, and how many more sit behind "+N more". */
export interface VisibleAppLines {
  shown: readonly UserDayAppActivityDto[];
  hidden: number;
}

/**
 * The first `max` apps of a day in the API's order (first activity of the day, then slug: the
 * order the apps were used in, never by time or counts) and the count of the rest. Pure.
 */
export function visibleAppLines(
  day: UserDayActivityDto,
  max: number = DAY_APP_LINES_SHOWN,
): VisibleAppLines {
  const shown = day.perApp.slice(0, max);
  return { shown, hidden: day.perApp.length - shown.length };
}

/** What an app line shows instead of a time when the app sent API calls only. */
export const NO_BROWSER_TIME = 'no browser time';

/**
 * The time of one app line: "2 h 40 min" when a page of it was on screen; NO_BROWSER_TIME for an
 * app seen only through API calls that day (no browser tracker, so "0 min" would read as "opened
 * but not looked at"); otherwise "0 min". Pure.
 */
export function appTimeLabel(app: UserDayAppActivityDto): string {
  if (app.activeMs > 0) return formatHoursMinutes(app.activeMs);
  if (app.requests > 0 && app.visits === 0) return NO_BROWSER_TIME;
  return formatHoursMinutes(0);
}

/** "09:41–13:10": an app's first and last recorded event of the day, India time. Pure. */
export function appClockSpan(app: UserDayAppActivityDto): string {
  return `${formatClockTime(app.firstActivityAt)}–${formatClockTime(app.lastActivityAt)}`;
}

// ─── Per-day chart ──────────────────────────────────────────────────────────

/** One IST day of the "Tab visible time per day" chart; `activity` is null on a day without any. */
export interface DailyTrendPoint {
  /** The instant of the day's IST midnight (ISO), like UserDayActivityDto.day. */
  day: string;
  activeMs: number;
  activity: UserDayActivityDto | null;
}

/**
 * One point per IST day of the window, oldest first, with 0 on the days without activity (the
 * API leaves them out). The window is the daily answer's (whole IST days: `from` is an IST
 * midnight), so stepping 24 h lands on every midnight; India keeps no daylight saving. Pure.
 */
export function fillReportingDays(
  items: readonly UserDayActivityDto[],
  window: { from: string; to: string },
): DailyTrendPoint[] {
  const byDay = new Map(items.map((item) => [Date.parse(item.day), item]));
  const points: DailyTrendPoint[] = [];
  const end = Date.parse(window.to);
  for (let at = Date.parse(window.from); at < end; at += DAY_MS) {
    const activity = byDay.get(at) ?? null;
    points.push({ day: new Date(at).toISOString(), activeMs: activity?.activeMs ?? 0, activity });
  }
  return points;
}

/**
 * The tooltip lines of one chart day under its tab visible time: "First – last activity 09:41 –
 * 18:03" (+ " so far" today) and "Apps: ebo-sales, hr-portal"; "No activity" on an empty day. Pure.
 */
export function trendPointNotes(point: DailyTrendPoint): string[] {
  const day = point.activity;
  if (day === null) return ['No activity'];
  const span = `${formatClockTime(day.firstActivityAt)} – ${formatClockTime(day.lastActivityAt)}`;
  return [
    `First – last activity ${span}${day.inProgress ? ' so far' : ''}`,
    `Apps: ${day.apps.join(', ')}`,
  ];
}

// ─── One-day view ───────────────────────────────────────────────────────────

/**
 * The person page opened on ONE day of the Daily activity tab: `?tab=daily&day=YYYY-MM-DD`, keeping
 * the current filters of `linkQuery` (app, env, and the range the list of days returns to). `day`
 * is the instant of an IST midnight (UserDayActivityDto.day). Pure.
 */
export function dayDetailHref(
  userKey: string,
  day: string,
  linkQuery: Readonly<Record<string, string | undefined>>,
): string {
  return withQuery(PAGES.userDetail(userKey), {
    ...linkQuery,
    tab: 'daily',
    day: reportingDayOf(new Date(day)),
  });
}

/** Where the day header's buttons lead (null = the button is disabled). */
export interface DayNavigation {
  previous: string | null;
  next: string | null;
  /** The oldest day the view opens (today − USER_DAY_LOOKBACK_DAYS), for the date input's `min`. */
  oldest: string;
  isToday: boolean;
}

/**
 * Previous / next day of `day` (`YYYY-MM-DD`), given today's IST day: no next day from today on,
 * no previous day at the lookback limit or before (the API refuses older days). A day outside
 * [oldest, today] (an edited or old link) steps INTO that range: Previous from a future day is
 * today, Next from a too-old day is the oldest day, never another day the API refuses. Pure.
 */
export function dayNavigation(day: string, today: string): DayNavigation {
  const oldest = addReportingDays(today, -USER_DAY_LOOKBACK_DAYS);
  return {
    previous: day > oldest ? (day > today ? today : addReportingDays(day, -1)) : null,
    next: day < today ? (day < oldest ? oldest : addReportingDays(day, 1)) : null,
    oldest,
    isToday: day === today,
  };
}

/** Whether a picked day (`YYYY-MM-DD`) is one the view can open: [oldest, today]. Pure. */
export function isOpenableDay(day: string, today: string): boolean {
  return day >= dayNavigation(today, today).oldest && day <= today;
}

/**
 * "5 h 12 min" of the day's Time in app; NO_BROWSER_TIME when it is 0 but the day has API calls
 * (an app without the browser tracker: "0 min" would read as "opened but not looked at"). Pure.
 */
export function timeInAppLabel(timeInAppMs: number, requests: number): string {
  if (timeInAppMs === 0 && requests > 0) return NO_BROWSER_TIME;
  return formatHoursMinutes(timeInAppMs);
}

/**
 * The steps of one visit of the day, read over THAT day (a custom range): with the global range a
 * visit of an older day would not be found. Keeps app and environment of `linkQuery`. Pure.
 */
export function visitStepsHref(
  visit: { app: string; sessionId: string },
  window: { from: string; to: string },
  linkQuery: Readonly<Record<string, string | undefined>>,
): string {
  return withQuery(PAGES.sessionDetail(visit.app, visit.sessionId), {
    range: 'custom',
    from: window.from,
    to: window.to,
    app: linkQuery.app,
    env: linkQuery.env,
  });
}

/** One block on the day timeline, in % of 24 hours from 00:00 IST. */
export interface DayTimelineSegment extends DayStripSpan {
  key: string;
}

/**
 * Where each activity block sits on the 00:00-24:00 timeline of `day` (an IST midnight instant):
 * clamped to the day, never narrower than MIN_STRIP_WIDTH_PCT and never past the right edge. Pure.
 */
export function blockSegments(
  day: string,
  blocks: readonly Pick<UserActivityBlockDto, 'startAt' | 'endAt'>[],
): DayTimelineSegment[] {
  return blocks.map((block) => ({
    key: block.startAt,
    ...dayStripSpan(day, block.startAt, block.endAt),
  }));
}

// ─── Usual activity hours (weekday × hour grid) ─────────────────────────────

/** ISO weekdays in grid order (Monday first), as in UserActivityPatternDto.weekdayDays. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
/** Hours of a day, 00-23 IST: the columns of the grid. */
export const HOURS_PER_DAY = 24;

/** One weekday-hour of the grid. */
export interface HourGridCell {
  hour: number;
  /** Calendar days of this weekday in the window with activity in this hour. */
  activeDays: number;
  /** Calendar days of this weekday in the window (the denominator). */
  weekdayDays: number;
  /** activeDays / weekdayDays, 0..1 (0 when the window has none of this weekday). */
  share: number;
  /** Tab visible time in this weekday-hour over the window. */
  activeMs: number;
  /** "Tuesday 10:00–11:00: activity on 4 of 4 Tuesdays, 2 h 10 min tab visible time". */
  label: string;
}

/** One weekday row of the grid (ISO 1 = Monday). */
export interface HourGridRow {
  weekday: number;
  name: (typeof WEEKDAY_NAMES)[number];
  weekdayDays: number;
  cells: HourGridCell[];
}

/** "10:00–11:00", "23:00–24:00": one hour of the day, India time. Pure. */
export function hourRangeLabel(hour: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hour)}:00–${pad(hour + 1)}:00`;
}

/** "1 Tuesday", "4 Tuesdays". Pure. */
function weekdayCount(count: number, name: string): string {
  return `${formatInteger(count)} ${count === 1 ? name : `${name}s`}`;
}

/**
 * The text of one cell, for its title, its aria-label and the hidden table: "Tuesday 10:00–11:00:
 * activity on 4 of 4 Tuesdays, 2 h 10 min tab visible time"; "… no activity on 4 Tuesdays" for an
 * empty hour. Pure.
 */
export function hourCellLabel(
  name: string,
  hour: number,
  activeDays: number,
  weekdayDays: number,
  activeMs: number,
): string {
  const when = `${name} ${hourRangeLabel(hour)}`;
  if (activeDays === 0) return `${when}: no activity on ${weekdayCount(weekdayDays, name)}`;
  return `${when}: activity on ${formatInteger(activeDays)} of ${weekdayCount(weekdayDays, name)}, ${formatHoursMinutes(activeMs)} tab visible time`;
}

/**
 * The full 7 × 24 grid (Monday first, hours 00-23 IST) from the API's non-empty cells: every
 * weekday-hour, with its share = active days / calendar days of that weekday in the window (never
 * above 1) and its text. Cells the API left out are empty (0 days). Pure.
 */
export function hourGridCells(pattern: UserActivityPatternDto): HourGridRow[] {
  const byCell = new Map(pattern.cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  return WEEKDAY_NAMES.map((name, index) => {
    const weekday = index + 1;
    const weekdayDays = pattern.weekdayDays[index] ?? 0;
    const cells = Array.from({ length: HOURS_PER_DAY }, (_, hour): HourGridCell => {
      const cell = byCell.get(`${weekday}:${hour}`);
      const activeDays = cell?.activeDays ?? 0;
      const activeMs = cell?.activeMs ?? 0;
      return {
        hour,
        activeDays,
        weekdayDays,
        share: weekdayDays > 0 ? Math.min(1, activeDays / weekdayDays) : 0,
        activeMs,
        label: hourCellLabel(name, hour, activeDays, weekdayDays, activeMs),
      };
    });
    return { weekday, name, weekdayDays, cells };
  });
}

/** The lightest shade of a cell with any activity, so a rare hour is still visible. */
export const MIN_ACTIVE_CELL_OPACITY = 0.15;

/**
 * The opacity of a cell's one colour: 0 for an empty hour, else MIN_ACTIVE_CELL_OPACITY up to 1 in
 * proportion to its share. Pure.
 */
export function hourCellOpacity(share: number): number {
  if (share <= 0) return 0;
  return MIN_ACTIVE_CELL_OPACITY + (1 - MIN_ACTIVE_CELL_OPACITY) * Math.min(1, share);
}
