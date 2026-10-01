import { describe, expect, it } from 'vitest';

import { filterLinkQuery, toTimeWindowQuery } from './useGlobalFilters';

describe('toTimeWindowQuery', () => {
  it('passes a valid preset and app through', () => {
    expect(toTimeWindowQuery({ app: 'ebo-sales', range: '7d', from: null, to: null })).toEqual({
      app: 'ebo-sales',
      range: '7d',
    });
  });

  it('keeps from/to only for a custom range', () => {
    const custom = toTimeWindowQuery({
      app: null,
      range: 'custom',
      from: '2026-10-01T09:00:00+05:30',
      to: '2026-10-01T18:00:00+05:30',
    });
    expect(custom).toEqual({
      range: 'custom',
      from: '2026-10-01T09:00:00+05:30',
      to: '2026-10-01T18:00:00+05:30',
    });
    expect(toTimeWindowQuery({ app: null, range: '1h', from: 'x', to: 'y' })).toEqual({
      range: '1h',
    });
  });

  it('falls back to the default range for an invalid custom range, keeping the app', () => {
    expect(
      toTimeWindowQuery({ app: 'ebo-sales', range: 'custom', from: 'nope', to: null }),
    ).toEqual({ app: 'ebo-sales', range: '24h' });
    expect(toTimeWindowQuery({ app: 'BAD SLUG', range: '1h', from: null, to: null })).toEqual({
      range: '24h',
    });
  });
});

describe('filterLinkQuery', () => {
  it('omits the default range so links stay short', () => {
    expect(filterLinkQuery({ range: '24h' })).toEqual({
      app: undefined,
      range: undefined,
      from: undefined,
      to: undefined,
    });
    expect(filterLinkQuery({ range: '7d', app: 'ebo-sales' }).range).toBe('7d');
  });
});
