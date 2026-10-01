import { describe, expect, it } from 'vitest';

import { toEndpointId, uuidV5 } from './endpoint-id';
import { liveRoom, liveScopeKey, SOCKET_EVENTS } from './events';
import { buildPath, listRoutes, ROUTES } from './routes';
import { endpointListQuerySchema, timeWindowQuerySchema } from './schemas';
import { grainFor, resolveTimeWindow, TimeWindowError } from './time-window';

describe('ROUTES', () => {
  it('versions every group except health and docs', () => {
    for (const { group, route } of listRoutes()) {
      if (group === 'health' || group === 'docs') continue;
      expect(route.path.startsWith(`/v1/`), `${group}`).toBe(true);
    }
  });

  it('has no duplicate method+path', () => {
    const keys = listRoutes().map(({ route }) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('buildPath encodes params and throws on missing ones', () => {
    expect(buildPath(ROUTES.apps.revokeKey, { slug: 'ebo-sales', keyId: 'a/b' })).toBe(
      '/v1/apps/ebo-sales/keys/a%2Fb',
    );
    expect(() => buildPath(ROUTES.apps.update, {} as { slug: string })).toThrow(/missing param/);
    expect(buildPath(ROUTES.endpoints.list)).toBe('/v1/endpoints');
  });
});

describe('socket contract', () => {
  it('builds stable scope keys and role rooms', () => {
    expect(liveScopeKey({})).toBe('all');
    expect(liveScopeKey({ app: 'ebo-sales' })).toBe('app:ebo-sales');
    expect(liveRoom({ app: 'ebo-sales' }, 'viewer')).toBe('app:ebo-sales:viewer');
    expect(SOCKET_EVENTS.trafficTick).toBe('traffic:tick');
  });
});

describe('time windows', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');

  it('picks grains by window length', () => {
    expect(grainFor(60 * 60_000)).toBe('minute');
    expect(grainFor(24 * 3_600_000)).toBe('hour');
    expect(grainFor(30 * 86_400_000)).toBe('day');
  });

  it('resolves presets with an equal-length previous window', () => {
    const w = resolveTimeWindow({ range: '24h' }, now);
    expect(w.to.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(w.from.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(w.previousFrom.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    expect(w.grain).toBe('hour');
  });

  it('validates custom ranges and caps', () => {
    expect(() => resolveTimeWindow({ range: 'custom', from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }, now)).toThrow(TimeWindowError);
    expect(() => resolveTimeWindow({ range: '90d' }, now, 31 * 86_400_000)).toThrow(/too large/);
  });

  it('query schema defaults range and requires from/to for custom', () => {
    expect(timeWindowQuerySchema.parse({}).range).toBe('24h');
    expect(timeWindowQuerySchema.safeParse({ range: 'custom' }).success).toBe(false);
    const q = endpointListQuerySchema.parse({ limit: '20', sort: 'p95' });
    expect(q).toMatchObject({ limit: 20, sort: 'p95', dir: 'desc', range: '24h' });
  });
});

describe('endpoint ids', () => {
  it('produces RFC 9562 v5 uuids deterministically', () => {
    // Known vector: uuidv5("www.example.com", DNS namespace)
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    const a = toEndpointId('ebo-sales', 'get', '/stores/:id');
    expect(a).toBe(toEndpointId('ebo-sales', 'GET', '/stores/:id'));
    expect(a).not.toBe(toEndpointId('ebo-sales', 'POST', '/stores/:id'));
  });
});
