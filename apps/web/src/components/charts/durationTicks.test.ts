import { describe, expect, it } from 'vitest';

import { formatHoursMinutesShort } from '@/lib/format';

import { durationTicks } from './durationTicks';

const MINUTE = 60_000;
const HOUR = 3_600_000;

function labels(maxMs: number): string[] {
  return durationTicks(maxMs).map(formatHoursMinutesShort);
}

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

describe('durationTicks + formatHoursMinutesShort', () => {
  it('uses whole minutes for a small max (7 minutes), never a repeated "0.1h"', () => {
    const ticks = labels(7 * MINUTE);
    expect(ticks).toEqual(['0', '2m', '4m', '6m', '8m']);
    expectUnique(ticks);
  });

  it('uses half hours around one hour', () => {
    const ticks = labels(62 * MINUTE);
    expect(ticks).toEqual(['0', '30m', '1h', '1h 30m']);
    expectUnique(ticks);
    expect(labels(HOUR)).toEqual(['0', '15m', '30m', '45m', '1h']);
  });

  it('uses whole hours around nine hours', () => {
    const ticks = labels(9 * HOUR);
    expect(ticks).toEqual(['0', '3h', '6h', '9h']);
    expectUnique(ticks);
    expectUnique(labels(9.2 * HOUR));
  });

  it('gives a readable axis for zero data', () => {
    expect(labels(0)).toEqual(['0', '1m']);
    expect(labels(Number.NaN)).toEqual(['0', '1m']);
  });

  it('starts at 0, reaches the max in at most 4 steps and never repeats a label', () => {
    for (const maxMs of [1, 30_000, 3 * MINUTE, 47 * MINUTE, 2.5 * HOUR, 13 * HOUR, 30 * HOUR]) {
      const ticks = durationTicks(maxMs);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(maxMs);
      expect(ticks.length).toBeLessThanOrEqual(5);
      expectUnique(ticks.map(formatHoursMinutesShort));
    }
  });

  it('reaches beyond a day in whole days (two visible tabs both count)', () => {
    const ticks = durationTicks(5 * 24 * HOUR);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(5 * 24 * HOUR);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expectUnique(ticks.map(formatHoursMinutesShort));
  });
});
