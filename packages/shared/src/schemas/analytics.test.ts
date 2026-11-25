/**
 * The one-day query (ROUTES.users.day) and the shape it is built from: extracting the time-window
 * fields into `timeWindowShape` must not change how the refined window query behaves.
 */
import { describe, expect, it } from 'vitest';

import { USER_PATTERN_RANGE_VALUES, userDayQuerySchema, userPatternQuerySchema } from './analytics';
import { reportingDaySchema, timeWindowQuerySchema } from './common';

describe('reportingDaySchema', () => {
  it('accepts a real calendar day written YYYY-MM-DD', () => {
    expect(reportingDaySchema.safeParse('2026-11-24').success).toBe(true);
    expect(reportingDaySchema.safeParse('2028-02-29').success).toBe(true);
  });

  it('refuses a day that does not exist, a short form and a datetime', () => {
    for (const bad of [
      '2026-02-30',
      '2026-02-29',
      '2026-13-01',
      '2026-1-5',
      '2026-11-24T00:00:00Z',
    ]) {
      expect(reportingDaySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('userDayQuerySchema', () => {
  it('parses day, app and env', () => {
    expect(
      userDayQuerySchema.parse({ day: '2026-11-24', app: 'ebo-sales', env: 'staging' }),
    ).toEqual({ day: '2026-11-24', app: 'ebo-sales', env: 'staging' });
  });

  it('strips a stray range instead of refusing it (the global range does not apply)', () => {
    const parsed = userDayQuerySchema.parse({ day: '2026-11-24', range: '7d', from: 'x' });
    expect(parsed).toEqual({ day: '2026-11-24' });
  });

  it('requires a valid day and refuses an unknown env or a bad app slug', () => {
    expect(userDayQuerySchema.safeParse({}).success).toBe(false);
    expect(userDayQuerySchema.safeParse({ day: '2026-02-30' }).success).toBe(false);
    expect(userDayQuerySchema.safeParse({ day: '2026-11-24', env: 'production' }).success).toBe(
      false,
    );
    expect(userDayQuerySchema.safeParse({ day: '2026-11-24', app: 'Not A Slug' }).success).toBe(
      false,
    );
  });
});

describe('userPatternQuerySchema', () => {
  it('defaults to the last 30 days and keeps app and env', () => {
    expect(userPatternQuerySchema.parse({})).toEqual({ range: '30d' });
    expect(userPatternQuerySchema.parse({ range: '7d', app: 'ebo-sales', env: 'staging' })).toEqual(
      { range: '7d', app: 'ebo-sales', env: 'staging' },
    );
    expect(USER_PATTERN_RANGE_VALUES).toEqual(['7d', '30d']);
  });

  it('refuses any other range (90d, 24h, custom) and an unknown env', () => {
    for (const range of ['90d', '24h', 'today', 'custom']) {
      expect(userPatternQuerySchema.safeParse({ range }).success, range).toBe(false);
    }
    expect(userPatternQuerySchema.safeParse({ env: 'production' }).success).toBe(false);
  });

  it('strips a stray from / to (the global custom range does not apply)', () => {
    expect(
      userPatternQuerySchema.parse({
        range: '7d',
        from: '2026-11-18T18:30:00.000Z',
        to: '2026-11-19T18:30:00.000Z',
      }),
    ).toEqual({ range: '7d' });
  });
});

describe('timeWindowQuerySchema after the shape extraction', () => {
  it('still defaults the range, requires from/to for custom and leaves env optional', () => {
    expect(timeWindowQuerySchema.parse({})).toEqual({ range: '24h' });
    expect(timeWindowQuerySchema.safeParse({ range: 'custom' }).success).toBe(false);
    expect(
      timeWindowQuerySchema.safeParse({
        range: 'custom',
        from: '2026-11-18T18:30:00.000Z',
        to: '2026-11-19T18:30:00.000Z',
      }).success,
    ).toBe(true);
    expect(timeWindowQuerySchema.safeParse({ range: '1y' }).success).toBe(false);
    expect(timeWindowQuerySchema.parse({ env: 'all', app: 'ebo-sales' })).toEqual({
      range: '24h',
      env: 'all',
      app: 'ebo-sales',
    });
  });
});
