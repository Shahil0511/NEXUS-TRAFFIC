import { describe, expect, it } from 'vitest';

import { computeMetric } from './compute-deltas';
import { percentOf, roundOrNull, roundTo } from './numbers';

describe('computeMetric', () => {
  it('computes the percentage change against the previous window', () => {
    expect(computeMetric(120, 100)).toEqual({ value: 120, previous: 100, deltaPct: 20 });
    expect(computeMetric(75, 100)).toEqual({ value: 75, previous: 100, deltaPct: -25 });
  });

  it('has no delta when the previous window is 0 or unknown (never Infinity)', () => {
    expect(computeMetric(5, 0)).toEqual({ value: 5, previous: 0, deltaPct: null });
    expect(computeMetric(5, null)).toEqual({ value: 5, previous: null, deltaPct: null });
    expect(computeMetric(null, 10)).toEqual({ value: null, previous: 10, deltaPct: null });
  });

  it('rounds values and delta to DTO precision', () => {
    expect(computeMetric(41.70000076293945, 30)).toEqual({
      value: 41.7,
      previous: 30,
      deltaPct: 39,
    });
    expect(computeMetric(1, 3).deltaPct).toBe(-66.67);
  });

  it('reports an unchanged value as 0 %, not -0', () => {
    expect(Object.is(computeMetric(10, 10).deltaPct, 0)).toBe(true);
  });
});

describe('numbers', () => {
  it('roundTo rounds half away from zero and never returns -0', () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(-2.346, 2)).toBe(-2.35);
    expect(Object.is(roundTo(-0.0001), 0)).toBe(true);
  });

  it('roundOrNull keeps null', () => {
    expect(roundOrNull(null)).toBeNull();
    expect(roundOrNull(3.14159)).toBe(3.14);
  });

  it('percentOf is null over nothing', () => {
    expect(percentOf(1, 0)).toBeNull();
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(0, 10)).toBe(0);
  });
});
