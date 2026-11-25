import type { UserDayActivityDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { EMPTY_USER_PATTERN, USER_DAILY, USER_PATTERN, userDayApp } from '@/test/fixtures';

import { EMPTY_VALUE } from '@/lib/format';

import {
  appClockSpan,
  appTimeLabel,
  averageLastLabel,
  averageTimeIntoDay,
  blockSegments,
  countLabel,
  DAY_APP_LINES_SHOWN,
  DAY_MS,
  dayDetailHref,
  dayNavigation,
  dayStripSpan,
  dayVisitsQuery,
  dayWindowQuery,
  MIN_STRIP_WIDTH_PCT,
  msIntoDay,
  fillReportingDays,
  hourCellLabel,
  hourCellOpacity,
  hourGridCells,
  hourRangeLabel,
  isOpenableDay,
  MIN_ACTIVE_CELL_OPACITY,
  NO_BROWSER_TIME,
  NOT_ENDED_YET,
  summarizeDays,
  timeInAppLabel,
  trendPointNotes,
  visibleAppLines,
  visitStepsHref,
  WEEKDAY_NAMES,
} from './dailyActivity';

/** IST midnight of 1 Oct 2026 (= 30 Sep 18:30 UTC). */
const DAY = '2026-09-30T18:30:00.000Z';
const HOUR = 3_600_000;
const at = (hoursIntoDay: number) => new Date(Date.parse(DAY) + hoursIntoDay * HOUR).toISOString();

describe('day strip position', () => {
  it('places 06:00 → 18:00 IST at 25 % with a 50 % width', () => {
    expect(dayStripSpan(DAY, at(6), at(18))).toEqual({ startPct: 25, widthPct: 50 });
  });

  it('reads the times as IST: 03:40 UTC is 09:10 IST', () => {
    const span = dayStripSpan(DAY, '2026-10-01T03:40:00.000Z', '2026-10-01T13:10:00.000Z');
    expect(span.startPct).toBeCloseTo(((9 + 10 / 60) / 24) * 100, 6);
    expect(span.startPct + span.widthPct).toBeCloseTo(((18 + 40 / 60) / 24) * 100, 6);
  });

  it('gives a one-event day a visible mark, never past the right edge', () => {
    expect(dayStripSpan(DAY, at(12), at(12))).toEqual({
      startPct: 50,
      widthPct: MIN_STRIP_WIDTH_PCT,
    });
    const late = dayStripSpan(DAY, at(23.999), at(23.999));
    expect(late.startPct + late.widthPct).toBeLessThanOrEqual(100);
  });

  it('clamps instants outside the day to its edges', () => {
    expect(msIntoDay(DAY, at(-1))).toBe(0);
    expect(msIntoDay(DAY, at(25))).toBe(DAY_MS);
    expect(dayStripSpan(DAY, at(-2), at(30))).toEqual({ startPct: 0, widthPct: 100 });
  });
});

describe('daily averages and totals', () => {
  it('averages the time of day of first and last activity over the active days', () => {
    const totals = summarizeDays(USER_DAILY.items);
    expect(totals.activeDays).toBe(2);
    // 09:10 and 10:00 → 09:35; 18:40 and 13:20 → 16:00.
    expect(totals.averageFirstMs).toBe((9 * 60 + 35) * 60_000);
    expect(totals.averageLastMs).toBe(16 * HOUR);
    expect(totals.totalTabVisibleMs).toBe(4 * HOUR);
  });

  it('leaves the day still running out of the average last activity only', () => {
    const [today, yesterday] = USER_DAILY.items;
    if (!today || !yesterday) throw new Error('fixture');
    const totals = summarizeDays([{ ...today, inProgress: true }, yesterday]);
    expect(totals.activeDays).toBe(2);
    expect(totals.averageFirstMs).toBe((9 * 60 + 35) * 60_000);
    // Only 30 Sep (ended): 13:20 IST.
    expect(totals.averageLastMs).toBe((13 * 60 + 20) * 60_000);
    expect(summarizeDays([{ ...today, inProgress: true }]).averageLastMs).toBeNull();
  });

  it('has no averages without days', () => {
    expect(summarizeDays([])).toEqual({
      activeDays: 0,
      averageFirstMs: null,
      averageLastMs: null,
      totalTabVisibleMs: 0,
    });
    expect(averageTimeIntoDay([], (day: UserDayActivityDto) => day.firstActivityAt)).toBeNull();
  });
});

describe('averageLastLabel', () => {
  it('prints the average with its unit, and never a unit after an empty value', () => {
    const [today, yesterday] = USER_DAILY.items;
    if (!today || !yesterday) throw new Error('fixture');
    expect(averageLastLabel(summarizeDays(USER_DAILY.items))).toBe('16:00 IST');
    // Only today, still running: nothing has ended yet.
    expect(averageLastLabel(summarizeDays([{ ...today, inProgress: true }]))).toBe(NOT_ENDED_YET);
    expect(averageLastLabel(summarizeDays([]))).toBe(EMPTY_VALUE);
  });
});

describe('one-day links', () => {
  it('turns an IST midnight into a custom range of exactly 24 hours', () => {
    expect(dayWindowQuery(DAY)).toEqual({
      range: 'custom',
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-01T18:30:00.000Z',
    });
  });

  it('narrows the Visits query to the person and the day, keeping app and environment only', () => {
    const query = dayVisitsQuery(
      DAY,
      { app: 'ebo-sales', env: 'staging', range: '7d', from: undefined, to: undefined },
      'a'.repeat(64),
    );
    expect(query).toEqual({
      app: 'ebo-sales',
      env: 'staging',
      userKey: 'a'.repeat(64),
      range: 'custom',
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-01T18:30:00.000Z',
    });
    // The bounds are one whole day, start inclusive, next midnight as the end.
    expect(Date.parse(query.to!) - Date.parse(query.from!)).toBe(DAY_MS);
  });

  it('drops a global custom range in favour of the day', () => {
    const query = dayVisitsQuery(
      DAY,
      { range: 'custom', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
      'a'.repeat(64),
    );
    expect(query.from).toBe('2026-09-30T18:30:00.000Z');
    expect(query.app).toBeUndefined();
    expect(query.env).toBeUndefined();
  });
});

describe('countLabel', () => {
  it('prints the count with the singular or plural noun', () => {
    expect(countLabel(1, 'page view', 'page views')).toBe('1 page view');
    expect(countLabel(0, 'page view', 'page views')).toBe('0 page views');
    expect(countLabel(1234, 'API call', 'API calls')).toBe('1,234 API calls');
  });
});

describe('per-app lines of a day', () => {
  const day = (count: number): UserDayActivityDto => {
    const [first] = USER_DAILY.items;
    if (!first) throw new Error('fixture');
    const perApp = Array.from({ length: count }, (_, i) => userDayApp(`app-${i}`));
    return { ...first, apps: perApp.map((app) => app.app), perApp };
  };

  it('shows the first three apps in the API order and counts the rest', () => {
    const lines = visibleAppLines(day(5));
    expect(DAY_APP_LINES_SHOWN).toBe(3);
    expect(lines.shown.map((app) => app.app)).toEqual(['app-0', 'app-1', 'app-2']);
    expect(lines.hidden).toBe(2);
    expect(visibleAppLines(day(2))).toMatchObject({ hidden: 0 });
    expect(visibleAppLines(day(5), 1).hidden).toBe(4);
  });

  it('labels an app line with its time, "no browser time" for API calls only, else 0 min', () => {
    expect(appTimeLabel(userDayApp('a', { activeMs: 9_600_000 }))).toBe('2 h 40 min');
    expect(appTimeLabel(userDayApp('a', { activeMs: 0, requests: 3, visits: 0 }))).toBe(
      NO_BROWSER_TIME,
    );
    expect(NO_BROWSER_TIME).toBe('no browser time');
    // Opened in a browser but no visible time yet: a real 0, not "no browser time".
    expect(appTimeLabel(userDayApp('a', { activeMs: 0, requests: 3, visits: 1 }))).toBe('0 min');
    expect(appTimeLabel(userDayApp('a', { activeMs: 0, requests: 0, visits: 0 }))).toBe('0 min');
  });

  it("reads an app's first and last event as IST clock times", () => {
    expect(appClockSpan(userDayApp('a'))).toBe('09:10–18:40');
  });
});

describe('per-day chart points', () => {
  const WINDOW = { from: '2026-09-27T18:30:00.000Z', to: '2026-10-01T18:30:00.000Z' };

  it('gives one point per IST day of the window, oldest first, 0 on days without activity', () => {
    const points = fillReportingDays(USER_DAILY.items, WINDOW);
    expect(points.map((point) => point.day)).toEqual([
      '2026-09-27T18:30:00.000Z',
      '2026-09-28T18:30:00.000Z',
      '2026-09-29T18:30:00.000Z',
      '2026-09-30T18:30:00.000Z',
    ]);
    expect(points.map((point) => point.activeMs)).toEqual([0, 0, 2_880_000, 11_520_000]);
    expect(points[0]?.activity).toBeNull();
    expect(points[3]?.activity).toBe(USER_DAILY.items[0]);
  });

  it('fills the whole window even without any activity, and nothing for an empty window', () => {
    expect(fillReportingDays([], WINDOW).every((point) => point.activeMs === 0)).toBe(true);
    expect(fillReportingDays([], { from: WINDOW.to, to: WINDOW.to })).toEqual([]);
  });

  it('describes a day in the tooltip: first – last activity and apps, or no activity', () => {
    const [point] = fillReportingDays(USER_DAILY.items, {
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-01T18:30:00.000Z',
    });
    if (!point) throw new Error('point');
    expect(trendPointNotes(point)).toEqual([
      'First – last activity 09:10 – 18:40',
      'Apps: ebo-sales',
    ]);
    const running = {
      ...point,
      activity: point.activity && { ...point.activity, inProgress: true },
    };
    expect(trendPointNotes(running)[0]).toBe('First – last activity 09:10 – 18:40 so far');
    expect(trendPointNotes({ ...point, activity: null })).toEqual(['No activity']);
  });
});

describe('one-day view helpers', () => {
  it('links a day row to the one-day view, keeping the filters', () => {
    expect(dayDetailHref('ab', DAY, { app: 'ebo-sales', range: '7d', env: undefined })).toBe(
      '/users/ab?app=ebo-sales&range=7d&tab=daily&day=2026-10-01',
    );
  });

  it('disables Next on today and Previous at the lookback limit (183 days back)', () => {
    expect(dayNavigation('2026-11-25', '2026-11-25')).toEqual({
      previous: '2026-11-24',
      next: null,
      oldest: '2026-05-26',
      isToday: true,
    });
    expect(dayNavigation('2026-11-30', '2026-12-01')).toMatchObject({
      previous: '2026-11-29',
      next: '2026-12-01',
      isToday: false,
    });
    expect(dayNavigation('2026-05-26', '2026-11-25')).toMatchObject({
      previous: null,
      next: '2026-05-27',
    });
  });

  it('steps from a day outside [today − 183 days, today] back into it, never further out', () => {
    expect(dayNavigation('2030-01-01', '2026-11-25')).toMatchObject({
      previous: '2026-11-25',
      next: null,
      isToday: false,
    });
    expect(dayNavigation('2026-01-01', '2026-11-25')).toMatchObject({
      previous: null,
      next: '2026-05-26',
    });
  });

  it('opens a picked day only inside [today − 183 days, today]', () => {
    expect(isOpenableDay('2026-11-25', '2026-11-25')).toBe(true);
    expect(isOpenableDay('2026-05-26', '2026-11-25')).toBe(true);
    expect(isOpenableDay('2026-05-25', '2026-11-25')).toBe(false);
    expect(isOpenableDay('2026-11-26', '2026-11-25')).toBe(false);
    expect(isOpenableDay('', '2026-11-25')).toBe(false);
  });

  it('says "no browser time" for a day of API calls only, else the time in app', () => {
    expect(timeInAppLabel(18_720_000, 3)).toBe('5 h 12 min');
    expect(timeInAppLabel(0, 3)).toBe(NO_BROWSER_TIME);
    expect(timeInAppLabel(0, 0)).toBe('0 min');
  });

  it('opens Visit steps over that one day, keeping app and environment only', () => {
    const window = { from: DAY, to: at(24) };
    const href = visitStepsHref({ app: 'ebo-sales', sessionId: 's-1' }, window, {
      app: 'ebo-sales',
      env: 'staging',
      range: '7d',
    });
    const [path, search] = href.split('?');
    expect(path).toBe('/journeys/ebo-sales/s-1');
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      range: 'custom',
      from: DAY,
      to: at(24),
      app: 'ebo-sales',
      env: 'staging',
    });
  });

  it('places each block on the 00:00-24:00 timeline, clamped, with a minimum width', () => {
    expect(
      blockSegments(DAY, [
        { startAt: at(6), endAt: at(12) },
        { startAt: at(18), endAt: at(18) },
        { startAt: at(-1), endAt: at(1) },
        { startAt: at(23.99), endAt: at(30) },
      ]),
    ).toEqual([
      { key: at(6), startPct: 25, widthPct: 25 },
      { key: at(18), startPct: 75, widthPct: MIN_STRIP_WIDTH_PCT },
      { key: at(-1), startPct: 0, widthPct: (1 / 24) * 100 },
      { key: at(23.99), startPct: 100 - MIN_STRIP_WIDTH_PCT, widthPct: MIN_STRIP_WIDTH_PCT },
    ]);
  });
});

describe('usual activity hours grid', () => {
  it('fills all 7 × 24 cells, Monday first, with the share of that weekday’s days', () => {
    const rows = hourGridCells(USER_PATTERN);
    expect(rows.map((row) => row.name)).toEqual([...WEEKDAY_NAMES]);
    expect(rows.map((row) => row.weekdayDays)).toEqual([4, 5, 5, 5, 4, 4, 4]);
    for (const row of rows)
      expect(row.cells.map((cell) => cell.hour)).toEqual([...Array(24).keys()]);
    const tuesday10 = rows[1]?.cells[10];
    expect(tuesday10).toMatchObject({
      activeDays: 4,
      weekdayDays: 5,
      share: 0.8,
      activeMs: 7_800_000,
    });
    expect(rows[3]?.cells[9]?.share).toBeCloseTo(0.4);
    expect(rows[6]?.cells[23]).toMatchObject({ activeDays: 1, share: 0.25, activeMs: 0 });
    // Every other cell is empty.
    const lit = rows.flatMap((row) => row.cells).filter((cell) => cell.activeDays > 0);
    expect(lit).toHaveLength(3);
  });

  it('labels each cell as a sentence: weekday, hour (IST), days of that weekday, tab visible time', () => {
    const rows = hourGridCells(USER_PATTERN);
    expect(rows[1]?.cells[10]?.label).toBe(
      'Tuesday 10:00–11:00: activity on 4 of 5 Tuesdays, 2 h 10 min tab visible time',
    );
    expect(rows[6]?.cells[23]?.label).toBe(
      'Sunday 23:00–24:00: activity on 1 of 4 Sundays, 0 min tab visible time',
    );
    expect(rows[0]?.cells[3]?.label).toBe('Monday 03:00–04:00: no activity on 4 Mondays');
    expect(hourCellLabel('Friday', 9, 1, 1, 60_000)).toBe(
      'Friday 09:00–10:00: activity on 1 of 1 Friday, 1 min tab visible time',
    );
    expect(hourRangeLabel(0)).toBe('00:00–01:00');
    expect(hourRangeLabel(23)).toBe('23:00–24:00');
  });

  it('never gives a share above 1, and 0 for a weekday the window does not have', () => {
    const odd = hourGridCells({
      ...USER_PATTERN,
      weekdayDays: [0, 1, 1, 1, 1, 1, 1],
      cells: [
        { weekday: 1, hour: 8, activeDays: 1, activeMs: 0 },
        { weekday: 2, hour: 8, activeDays: 3, activeMs: 0 },
      ],
    });
    expect(odd[0]?.cells[8]?.share).toBe(0);
    expect(odd[1]?.cells[8]?.share).toBe(1);
  });

  it('an empty range gives an all-empty grid', () => {
    const cells = hourGridCells(EMPTY_USER_PATTERN).flatMap((row) => row.cells);
    expect(cells).toHaveLength(168);
    expect(cells.every((cell) => cell.share === 0 && cell.activeDays === 0)).toBe(true);
  });

  it('shades with one colour: empty is transparent, any activity at least the minimum, all days full', () => {
    expect(hourCellOpacity(0)).toBe(0);
    expect(hourCellOpacity(0.01)).toBeGreaterThanOrEqual(MIN_ACTIVE_CELL_OPACITY);
    expect(hourCellOpacity(0.5)).toBeCloseTo(
      MIN_ACTIVE_CELL_OPACITY + (1 - MIN_ACTIVE_CELL_OPACITY) / 2,
    );
    expect(hourCellOpacity(1)).toBe(1);
    expect(hourCellOpacity(2)).toBe(1);
  });
});
