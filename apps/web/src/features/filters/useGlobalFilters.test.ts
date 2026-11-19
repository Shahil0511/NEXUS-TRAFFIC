import { describe, expect, it } from 'vitest';

import { filterLinkQuery, toTimeWindowQuery } from './useGlobalFilters';

describe('toTimeWindowQuery', () => {
  it('passes a valid preset and app through', () => {
    expect(
      toTimeWindowQuery({ app: 'ebo-sales', range: '7d', from: null, to: null, env: null }),
    ).toEqual({
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
      env: null,
    });
    expect(custom).toEqual({
      range: 'custom',
      from: '2026-10-01T09:00:00+05:30',
      to: '2026-10-01T18:00:00+05:30',
    });
    expect(toTimeWindowQuery({ app: null, range: '1h', from: 'x', to: 'y', env: null })).toEqual({
      range: '1h',
    });
  });

  it('falls back to the default range for an invalid custom range, keeping the app', () => {
    expect(
      toTimeWindowQuery({ app: 'ebo-sales', range: 'custom', from: 'nope', to: null, env: null }),
    ).toEqual({ app: 'ebo-sales', range: '24h' });
    expect(
      toTimeWindowQuery({ app: 'BAD SLUG', range: '1h', from: null, to: null, env: null }),
    ).toEqual({
      range: '24h',
    });
  });
});

describe('toTimeWindowQuery environment', () => {
  it('passes the environment filter through (absent = production, applied by the API)', () => {
    expect(
      toTimeWindowQuery({ app: null, range: '7d', from: null, to: null, env: 'staging' }),
    ).toEqual({ range: '7d', env: 'staging' });
    expect(
      toTimeWindowQuery({ app: null, range: '7d', from: null, to: null, env: null }).env,
    ).toBeUndefined();
  });

  it('keeps the environment in BOTH fallbacks', () => {
    expect(
      toTimeWindowQuery({ app: 'ebo-sales', range: 'custom', from: 'nope', to: null, env: 'dev' }),
    ).toEqual({ app: 'ebo-sales', range: '24h', env: 'dev' });
    expect(
      toTimeWindowQuery({ app: 'BAD SLUG', range: '1h', from: null, to: null, env: 'all' }),
    ).toEqual({ range: '24h', env: 'all' });
  });
});

describe('filterLinkQuery', () => {
  it('omits the default range and environment so links stay short', () => {
    expect(filterLinkQuery({ range: '24h' })).toEqual({
      app: undefined,
      range: undefined,
      from: undefined,
      to: undefined,
      env: undefined,
    });
    expect(filterLinkQuery({ range: '7d', app: 'ebo-sales' }).range).toBe('7d');
    expect(filterLinkQuery({ range: '24h', env: 'prod' }).env).toBeUndefined();
  });

  it('carries a non-production environment along', () => {
    expect(filterLinkQuery({ range: '24h', env: 'staging' }).env).toBe('staging');
    expect(filterLinkQuery({ range: '24h', env: 'all' }).env).toBe('all');
  });
});
