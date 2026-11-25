/**
 * The IST calendar-day helpers of the one-day view (ROUTES.users.day). India keeps no daylight
 * saving, so every day is exactly 24 h starting at 18:30Z of the day before.
 */
import { describe, expect, it } from 'vitest';

import {
  addReportingDays,
  reportingDayOf,
  reportingDayWindow,
  startOfReportingDay,
  TimeWindowError,
  weekdayDayCounts,
  wholeReportingDays,
} from './time-window';

describe('reportingDayWindow', () => {
  it('is 00:00 IST of the day up to the next 00:00 IST', () => {
    const window = reportingDayWindow('2026-11-19');
    expect(window.from.toISOString()).toBe('2026-11-18T18:30:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-19T18:30:00.000Z');
  });

  it('starts where startOfReportingDay puts that day', () => {
    const window = reportingDayWindow('2026-03-01');
    expect(startOfReportingDay(new Date('2026-03-01T12:00:00Z'))).toEqual(window.from);
  });

  it('refuses text that is not YYYY-MM-DD', () => {
    expect(() => reportingDayWindow('2026-1-5')).toThrow(TimeWindowError);
    expect(() => reportingDayWindow('2026-11-19T00:00:00Z')).toThrow(TimeWindowError);
  });
});

describe('reportingDayOf', () => {
  it('names the IST day of an instant: 18:29:59Z is still that day, 18:30Z the next', () => {
    expect(reportingDayOf(new Date('2026-11-19T18:29:59.999Z'))).toBe('2026-11-19');
    expect(reportingDayOf(new Date('2026-11-19T18:30:00.000Z'))).toBe('2026-11-20');
  });

  it('round-trips with reportingDayWindow', () => {
    expect(reportingDayOf(reportingDayWindow('2026-12-31').from)).toBe('2026-12-31');
  });
});

describe('addReportingDays', () => {
  it('moves across a month end and a year end, both ways', () => {
    expect(addReportingDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addReportingDays('2026-12-01', -1)).toBe('2026-11-30');
    expect(addReportingDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addReportingDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addReportingDays('2026-11-25', -183)).toBe('2026-05-26');
    expect(addReportingDays('2026-11-25', 0)).toBe('2026-11-25');
  });
});

describe('weekdayDayCounts', () => {
  const DAY = 86_400_000;
  /** The whole IST days of the window ending at `now`, `days` long, like users.pattern widens it. */
  const wholeDaysBack = (now: Date, days: number) =>
    wholeReportingDays({ from: new Date(now.getTime() - days * DAY), to: now });

  it('counts the IST days of each weekday, Monday first; 30 and 31 whole days add up', () => {
    // 2026-11-23 is a Monday (IST); 30 whole days from it end on Tuesday 2026-12-22.
    const from = reportingDayWindow('2026-11-23').from;
    const thirty = weekdayDayCounts({ from, to: new Date(from.getTime() + 30 * DAY) });
    expect(thirty).toEqual([5, 5, 4, 4, 4, 4, 4]);
    expect(thirty.reduce((a, b) => a + b, 0)).toBe(30);
    const thirtyOne = weekdayDayCounts({ from, to: new Date(from.getTime() + 31 * DAY) });
    expect(thirtyOne).toEqual([5, 5, 5, 4, 4, 4, 4]);
    expect(thirtyOne.reduce((a, b) => a + b, 0)).toBe(31);
  });

  it('names the weekday in India time, not UTC (18:30Z is already the next IST day)', () => {
    // Monday 2026-11-23 00:00 IST is Sunday 18:30Z in UTC.
    const monday = reportingDayWindow('2026-11-23');
    expect(weekdayDayCounts(monday)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(weekdayDayCounts(reportingDayWindow('2026-11-29'))).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it('the last 30 / 7 days widened to whole days are 31 / 8 days, every weekday present', () => {
    const now = new Date('2026-11-25T09:30:00.000Z'); // 15:00 IST, Wednesday
    const month = weekdayDayCounts(wholeDaysBack(now, 30));
    expect(month.reduce((a, b) => a + b, 0)).toBe(31);
    expect(month.every((count) => count >= 4)).toBe(true);
    const week = weekdayDayCounts(wholeDaysBack(now, 7));
    expect(week.reduce((a, b) => a + b, 0)).toBe(8);
    // Wednesday is both the oldest and today's weekday.
    expect(week).toEqual([1, 1, 2, 1, 1, 1, 1]);
  });

  it('a window cut inside a day still counts that day once', () => {
    expect(
      weekdayDayCounts({
        from: new Date('2026-11-23T05:00:00.000Z'),
        to: new Date('2026-11-23T06:00:00.000Z'),
      }),
    ).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});
