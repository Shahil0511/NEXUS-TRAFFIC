import { ROUTES } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { api } from '../api';
import { qk } from './keys';

describe('query keys (qk mirrors ROUTES)', () => {
  it('uses group.leaf names that exist in ROUTES and in api', () => {
    const routes = ROUTES as unknown as Record<string, Record<string, unknown>>;
    const client = api as unknown as Record<string, Record<string, unknown>>;
    for (const [group, leaves] of Object.entries(qk)) {
      for (const leaf of Object.keys(leaves).filter((name) => name !== 'all')) {
        expect(routes[group]?.[leaf], `${group}.${leaf} in ROUTES`).toBeDefined();
        expect(client[group]?.[leaf], `${group}.${leaf} in api`).toBeDefined();
      }
    }
  });

  it('starts every key with its group prefix, so invalidating `all` hits the group', () => {
    const list = qk.endpoints.list({ range: '24h', sort: 'calls', dir: 'desc', limit: 50 });
    expect(list.slice(0, 1)).toEqual([...qk.endpoints.all]);
    expect(qk.errors.summary({ range: '24h' })[0]).toBe(qk.errors.all[0]);
  });

  it('changes when any filter changes (new cache entry, new request)', () => {
    const base = qk.overview.summary({ range: '24h' });
    expect(qk.overview.summary({ range: '7d' })).not.toEqual(base);
    expect(qk.overview.summary({ range: '24h', app: 'ebo-sales' })).not.toEqual(base);
    expect(qk.overview.summary({ range: '24h' })).toEqual(base);
  });

  it('keys the endpoint detail by its opaque id', () => {
    expect(qk.endpoints.detail('id-1', { range: '24h' })).toEqual([
      'endpoints',
      'detail',
      'id-1',
      { range: '24h' },
    ]);
  });
});
