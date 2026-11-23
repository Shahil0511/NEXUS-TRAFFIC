import { describe, expect, it } from 'vitest';

import {
  barWidthPct,
  formatShare,
  REMAINDER_KEY,
  REMAINDER_LABEL,
  shareLabel,
  withRemainder,
  type ProportionRow,
} from './proportionShares';

const ROWS: ProportionRow[] = [
  { key: 'v:Chrome', label: 'Chrome', count: 640, share: 0.64 },
  { key: 'v:Safari', label: 'Safari', count: 250, share: 0.25 },
  { key: '', label: 'Not sent', muted: true, count: 10, share: 0.01 },
];

describe('formatShare / shareLabel', () => {
  it('prints whole percents and never a misleading 0% for a real value', () => {
    expect(formatShare(0.3)).toBe('30%');
    expect(formatShare(0.646)).toBe('65%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(Number.NaN)).toBe('0%');
  });

  it('always carries the unit inside the label', () => {
    expect(shareLabel(0.3, 'page views')).toBe('30% of page views');
    expect(shareLabel(0.004, 'requests')).toBe('<1% of requests');
  });
});

describe('barWidthPct', () => {
  it('is the share of the whole total, clamped, and visible when non-zero', () => {
    expect(barWidthPct(0.3)).toBe(30);
    expect(barWidthPct(1.2)).toBe(100);
    expect(barWidthPct(0.0001)).toBe(1);
    expect(barWidthPct(0)).toBe(0);
    expect(barWidthPct(-1)).toBe(0);
  });
});

describe('withRemainder', () => {
  it('adds one muted "All other values" row for what the top list leaves out', () => {
    const rows = withRemainder(ROWS, 1_000);
    expect(rows).toHaveLength(4);
    expect(rows.at(-1)).toEqual({
      key: REMAINDER_KEY,
      label: REMAINDER_LABEL,
      muted: true,
      count: 100,
      share: 0.1,
    });
    // The remainder key can never collide with a listed value.
    expect(ROWS.map((row) => row.key)).not.toContain(REMAINDER_KEY);
  });

  it('leaves the rows alone when they already cover the total, or there is none', () => {
    expect(withRemainder(ROWS, 900)).toBe(ROWS);
    expect(withRemainder(ROWS, 0)).toBe(ROWS);
    expect(withRemainder([], 0)).toEqual([]);
  });
});
