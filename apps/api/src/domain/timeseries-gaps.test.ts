import type { TimeseriesPointDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  bucketStartOf,
  bucketStarts,
  emptyPoint,
  fillTimeseriesGaps,
  fillToolTrendGaps,
  withPageViews,
} from './timeseries-gaps';

const point = (bucket: string, requests: number): TimeseriesPointDto => ({
  ...emptyPoint(new Date(bucket)),
  requests,
  p95Ms: 10,
});

describe('bucketStartOf (IST-aligned, like bucketExpr in src/db/sql.ts)', () => {
  it('hour buckets start at :30 UTC (IST is +05:30)', () => {
    expect(bucketStartOf(new Date('2026-10-01T09:15:00Z'), 'hour').toISOString()).toBe(
      '2026-10-01T08:30:00.000Z',
    );
    expect(bucketStartOf(new Date('2026-10-01T09:30:00Z'), 'hour').toISOString()).toBe(
      '2026-10-01T09:30:00.000Z',
    );
  });

  it('day buckets start at IST midnight (18:30 UTC the day before)', () => {
    expect(bucketStartOf(new Date('2026-10-01T10:00:00Z'), 'day').toISOString()).toBe(
      '2026-09-30T18:30:00.000Z',
    );
    expect(bucketStartOf(new Date('2026-10-01T18:29:59Z'), 'day').toISOString()).toBe(
      '2026-09-30T18:30:00.000Z',
    );
    expect(bucketStartOf(new Date('2026-10-01T18:30:00Z'), 'day').toISOString()).toBe(
      '2026-10-01T18:30:00.000Z',
    );
  });

  it('minute buckets truncate seconds', () => {
    expect(bucketStartOf(new Date('2026-10-01T09:15:59.999Z'), 'minute').toISOString()).toBe(
      '2026-10-01T09:15:00.000Z',
    );
  });
});

describe('bucketStarts', () => {
  it('covers the window from the bucket containing `from` up to (excluding) `to`', () => {
    const starts = bucketStarts({
      from: new Date('2026-10-01T06:00:00Z'),
      to: new Date('2026-10-01T09:00:00Z'),
      grain: 'hour',
    });
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-10-01T05:30:00.000Z',
      '2026-10-01T06:30:00.000Z',
      '2026-10-01T07:30:00.000Z',
      '2026-10-01T08:30:00.000Z',
    ]);
  });

  it('is empty for an empty window', () => {
    const at = new Date('2026-10-01T06:00:00Z');
    expect(bucketStarts({ from: at, to: at, grain: 'minute' })).toEqual([]);
  });
});

describe('fillTimeseriesGaps', () => {
  const window = {
    from: new Date('2026-10-01T06:00:00Z'),
    to: new Date('2026-10-01T09:00:00Z'),
    grain: 'hour' as const,
  };

  it('inserts zero buckets between existing ones, oldest first', () => {
    const filled = fillTimeseriesGaps([point('2026-10-01T07:30:00.000Z', 4)], window);
    expect(filled.map((p) => [p.bucket, p.requests, p.p95Ms])).toEqual([
      ['2026-10-01T05:30:00.000Z', 0, null],
      ['2026-10-01T06:30:00.000Z', 0, null],
      ['2026-10-01T07:30:00.000Z', 4, 10],
      ['2026-10-01T08:30:00.000Z', 0, null],
    ]);
  });

  it('returns only zeros when there is no data, and never drops an unexpected point', () => {
    expect(fillTimeseriesGaps([], window).every((p) => p.requests === 0)).toBe(true);
    const stray = point('2026-10-01T09:30:00.000Z', 1);
    expect(fillTimeseriesGaps([stray], window).at(-1)).toEqual(stray);
  });
});

describe('withPageViews', () => {
  it('merges page views by bucket and leaves other buckets alone', () => {
    const points = [point('2026-10-01T05:30:00.000Z', 1), point('2026-10-01T06:30:00.000Z', 2)];
    const merged = withPageViews(points, new Map([['2026-10-01T06:30:00.000Z', 9]]));
    expect(merged.map((p) => p.pageViews)).toEqual([0, 9]);
    expect(merged.map((p) => p.requests)).toEqual([1, 2]);
  });
});

describe('fillToolTrendGaps', () => {
  it('one point per IST-aligned bucket, zeros for missing ones, existing points kept', () => {
    const window = {
      from: new Date('2026-10-01T06:00:00Z'),
      to: new Date('2026-10-01T09:00:00Z'),
      grain: 'hour' as const,
    };
    expect(fillToolTrendGaps([{ bucket: '2026-10-01T06:30:00.000Z', uses: 4 }], window)).toEqual([
      { bucket: '2026-10-01T05:30:00.000Z', uses: 0 },
      { bucket: '2026-10-01T06:30:00.000Z', uses: 4 },
      { bucket: '2026-10-01T07:30:00.000Z', uses: 0 },
      { bucket: '2026-10-01T08:30:00.000Z', uses: 0 },
    ]);
  });
});
