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
