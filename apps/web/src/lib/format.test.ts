import { describe, expect, it } from 'vitest';

import {
  EMPTY_VALUE,
  formatBucket,
  formatClockOffset,
  formatClockTime,
  formatCompact,
  formatDateTime,
  formatDay,
  formatDeltaPct,
  formatCountry,
  formatDuration,
  formatElapsed,
  formatHoursMinutes,
  formatHoursMinutesShort,
  formatInteger,
  formatOsName,
  formatPercent,
  formatWindowCaption,
  fromIstInputValue,
  perGrain,
  toIstInputValue,
  UNKNOWN_COUNTRY,
  withUnit,
} from './format';

describe('format helpers', () => {
  it('formats instants in IST whatever the machine timezone', () => {
    // 08:35:09 UTC = 14:05:09 IST
    expect(formatDateTime('2026-10-01T08:35:09Z')).toMatch(/1 Oct.*14:05:09/);
    expect(formatBucket('2026-10-01T08:30:00Z', 'minute')).toBe('14:00');
    expect(formatBucket('2026-10-01T20:00:00Z', 'day')).toMatch(/2 Oct/);
  });

  it('renders null as an em dash, never as 0', () => {
    expect(formatDateTime(null)).toBe(EMPTY_VALUE);
    expect(formatDuration(null)).toBe(EMPTY_VALUE);
    expect(formatCompact(undefined)).toBe(EMPTY_VALUE);
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(formatDeltaPct(null)).toBe(EMPTY_VALUE);
    expect(formatInteger(Number.NaN)).toBe(EMPTY_VALUE);
  });

  it('formats durations in ms, s and minutes', () => {
    expect(formatDuration(840.4)).toBe('840 ms');
    expect(formatDuration(1234)).toBe('1.23 s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('uses Indian digit grouping and compact units', () => {
    expect(formatInteger(1_234_567)).toBe('12,34,567');
    expect(formatCompact(1234)).toBe('1.2K');
    expect(formatCompact(1_234_567)).toBe('12.3L');
  });

  it('signs deltas with a real minus', () => {
    expect(formatDeltaPct(12.34)).toBe('+12.3%');
    expect(formatDeltaPct(-4)).toBe('−4.0%');
    expect(formatDeltaPct(0)).toBe('0.0%');
    expect(formatPercent(3.456)).toBe('3.5%');
  });

  it('round-trips datetime-local values through IST', () => {
    expect(toIstInputValue('2026-10-01T08:35:00Z')).toBe('2026-10-01T14:05');
    expect(fromIstInputValue('2026-10-01T14:05')).toBe('2026-10-01T14:05:00+05:30');
    expect(new Date(fromIstInputValue('2026-10-01T14:05')).toISOString()).toBe(
      '2026-10-01T08:35:00.000Z',
    );
  });

  it('captions a response window with its grain', () => {
    const caption = formatWindowCaption({
      from: '2026-09-30T08:00:00Z',
      to: '2026-10-01T08:00:00Z',
      grain: 'hour',
    });
    expect(caption).toMatch(/^30 Sept?, 13:30 – 1 Oct, 13:30 IST · hourly buckets$/);
  });

  it('formats session offsets as +m:ss / +h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('+0:00');
    expect(formatElapsed(42_000)).toBe('+0:42');
    expect(formatElapsed(754_900)).toBe('+12:34');
    expect(formatElapsed(3_723_000)).toBe('+1:02:03');
    expect(formatElapsed(null)).toBe(EMPTY_VALUE);
  });

  it('names countries and labels unknown ones', () => {
    expect(formatCountry('IN')).toBe('India');
    expect(formatCountry('ae')).toBe('United Arab Emirates');
    expect(formatCountry(null)).toBe(UNKNOWN_COUNTRY);
    expect(formatCountry('EU-X')).toBe('EU-X');
  });
});

describe('person-page time formats', () => {
  it('formats durations as hours and minutes ("3 h 12 min")', () => {
    expect(formatHoursMinutes(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 min');
    expect(formatHoursMinutes(45 * 60_000)).toBe('45 min');
    expect(formatHoursMinutes(2 * 3_600_000)).toBe('2 h');
    expect(formatHoursMinutes(89_990)).toBe('1 min');
    expect(formatHoursMinutes(59 * 60_000 + 40_000)).toBe('1 h');
    expect(formatHoursMinutes(20_000)).toBe('< 1 min');
    expect(formatHoursMinutes(0)).toBe('0 min');
    expect(formatHoursMinutes(null)).toBe(EMPTY_VALUE);
    expect(formatHoursMinutes(-1)).toBe(EMPTY_VALUE);
  });

  it('prints the same hours and minutes in a short axis form', () => {
    expect(formatHoursMinutesShort(0)).toBe('0');
    expect(formatHoursMinutesShort(5 * 60_000)).toBe('5m');
    expect(formatHoursMinutesShort(90 * 60_000)).toBe('1h 30m');
    expect(formatHoursMinutesShort(6 * 3_600_000)).toBe('6h');
    expect(formatHoursMinutesShort(59 * 60_000 + 40_000)).toBe('1h');
    expect(formatHoursMinutesShort(null)).toBe(EMPTY_VALUE);
    expect(formatHoursMinutesShort(-1)).toBe(EMPTY_VALUE);
  });

  it('prints IST clock times, offsets after midnight and calendar days', () => {
    // 03:40 UTC = 09:10 IST
    expect(formatClockTime('2026-10-01T03:40:00Z')).toBe('09:10');
    expect(formatClockTime(null)).toBe(EMPTY_VALUE);
    expect(formatClockOffset(9 * 3_600_000 + 10 * 60_000 + 59_000)).toBe('09:10');
    expect(formatClockOffset(0)).toBe('00:00');
    expect(formatClockOffset(undefined)).toBe(EMPTY_VALUE);
    // IST midnight of 1 Oct is 30 Sep 18:30 UTC.
    expect(formatDay('2026-09-30T18:30:00.000Z')).toMatch(/Thu.*1 Oct.*2026/);
  });
});

describe('withUnit', () => {
  it('adds the unit to a value and never to an empty one', () => {
    expect(withUnit('09:10', 'IST')).toBe('09:10 IST');
    expect(withUnit(formatClockOffset(null), 'IST')).toBe(EMPTY_VALUE);
    expect(withUnit(formatDateTime(undefined), 'IST')).toBe(EMPTY_VALUE);
  });
});

describe('formatOsName', () => {
  it('drops the frozen macOS version the User-Agent carries', () => {
    expect(formatOsName('Mac OS 10')).toBe('macOS');
    expect(formatOsName('Mac OS')).toBe('macOS');
    expect(formatOsName('Mac OS X 10')).toBe('macOS');
    expect(formatOsName('macOS 14')).toBe('macOS');
  });

  it('keeps every other system as stored', () => {
    expect(formatOsName('Windows 10')).toBe('Windows 10');
    expect(formatOsName('iOS 17')).toBe('iOS 17');
    expect(formatOsName('Android 14')).toBe('Android 14');
    expect(formatOsName('Chrome OS 120')).toBe('Chrome OS 120');
  });
});

describe('perGrain', () => {
  it('names the chart grain in words, and says "over time" before it is known', () => {
    expect(perGrain('minute')).toBe('per minute');
    expect(perGrain('hour')).toBe('per hour');
    expect(perGrain('day')).toBe('per day');
    expect(perGrain(undefined)).toBe('over time');
  });
});
