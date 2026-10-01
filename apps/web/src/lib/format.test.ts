import { describe, expect, it } from 'vitest';

import {
  EMPTY_VALUE,
  formatBucket,
  formatCompact,
  formatDateTime,
  formatDeltaPct,
  formatDuration,
  formatInteger,
  formatPercent,
  formatWindowCaption,
  fromIstInputValue,
  toIstInputValue,
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
});
