import { describe, expect, it } from 'vitest';

import { isolatedIndexes } from './LatencyChart';

describe('isolatedIndexes', () => {
  it('marks values with no valued neighbour (they would be invisible as a line)', () => {
    const points = [
      { p95Ms: null },
      { p95Ms: 120 },
      { p95Ms: null },
      { p95Ms: 80 },
      { p95Ms: 90 },
      { p95Ms: null },
    ];
    expect([...isolatedIndexes(points)]).toEqual([1]);
    expect([...isolatedIndexes([{ p95Ms: 5 }])]).toEqual([0]);
  });
});
