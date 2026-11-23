import type { UserDayActivityDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { USER_DAILY } from '@/test/fixtures';

import {
  averageTimeIntoDay,
  DAY_MS,
  dayStripSpan,
  MIN_STRIP_WIDTH_PCT,
  msIntoDay,
  summarizeDays,
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
    expect(totals.daysActive).toBe(2);
    // 09:10 and 10:00 → 09:35; 18:40 and 13:20 → 16:00.
    expect(totals.averageFirstMs).toBe((9 * 60 + 35) * 60_000);
    expect(totals.averageLastMs).toBe(16 * HOUR);
    expect(totals.totalActiveMs).toBe(4 * HOUR);
  });

  it('leaves the day still running out of the average last activity only', () => {
    const [today, yesterday] = USER_DAILY.items;
    if (!today || !yesterday) throw new Error('fixture');
    const totals = summarizeDays([{ ...today, inProgress: true }, yesterday]);
    expect(totals.daysActive).toBe(2);
    expect(totals.averageFirstMs).toBe((9 * 60 + 35) * 60_000);
    // Only 30 Sep (ended): 13:20 IST.
    expect(totals.averageLastMs).toBe((13 * 60 + 20) * 60_000);
    expect(summarizeDays([{ ...today, inProgress: true }]).averageLastMs).toBeNull();
  });

  it('has no averages without days', () => {
    expect(summarizeDays([])).toEqual({
      daysActive: 0,
      averageFirstMs: null,
      averageLastMs: null,
      totalActiveMs: 0,
    });
    expect(averageTimeIntoDay([], (day: UserDayActivityDto) => day.firstActivityAt)).toBeNull();
  });
});
