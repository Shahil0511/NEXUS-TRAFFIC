import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_FILTER_VALUES,
  ENVIRONMENT_VALUES,
  EVENT_CLOCK_POLICY,
  BREAKDOWN_DIMENSION_VALUES,
  SDK_DEFAULTS,
  SERVER_BREAKDOWN_DIMENSION_VALUES,
  SSO_COOKIE_OUTCOME_VALUES,
  type SsoCookieOutcome,
} from './constants';
import { toEndpointId, uuidV5 } from './endpoint-id';
import {
  ERROR_CODES,
  INGEST_EVENT_REJECT_CODES,
  INGEST_REJECTION_CODE_VALUES,
  IP_FAILURE_ERROR_CODES,
  KEY_GUESS_ERROR_CODES,
  SDK_KILL_ERROR_CODES,
} from './errors';
import { liveRoom, liveScopeKey, parseLiveRoom, SOCKET_EVENTS } from './events';
import {
  buildPath,
  listRoutes,
  NON_DASHBOARD_ROUTE_GROUPS,
  PENDING_ROUTE_LEAVES,
  ROUTES,
} from './routes';
import {
  breakdownOverviewQuerySchema,
  endpointListQuerySchema,
  timeWindowQuerySchema,
  updateSdkConfigBodySchema,
} from './schemas';
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

  it('lists each pending leaf once, and only real leaves', () => {
    const known = new Set(listRoutes().map(({ group, leaf }) => `${group}.${leaf}`));
    expect(new Set(PENDING_ROUTE_LEAVES).size).toBe(PENDING_ROUTE_LEAVES.length);
    expect(PENDING_ROUTE_LEAVES.filter((id) => !known.has(id))).toEqual([]);
  });

  it('names only real groups as non-dashboard groups', () => {
    for (const group of NON_DASHBOARD_ROUTE_GROUPS) expect(ROUTES[group]).toBeDefined();
  });

  it('serves the Phase A leaves under /v1 with the agreed verbs', () => {
    expect(ROUTES.ingest.config).toEqual({ method: 'POST', path: '/v1/ingest/config' });
    expect(ROUTES.apps.updateSdkConfig).toEqual({ method: 'PATCH', path: '/v1/apps/:slug/sdk-config' });
    expect(ROUTES.overview.breakdown).toEqual({ method: 'GET', path: '/v1/overview/breakdown' });
    expect(ROUTES.overview.devices).toEqual({ method: 'GET', path: '/v1/overview/devices' });
    expect(PENDING_ROUTE_LEAVES).toEqual([]);
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

  it('parses role rooms back and ignores other rooms', () => {
    expect(parseLiveRoom('app:ebo-sales:viewer')).toEqual({
      scope: 'app:ebo-sales',
      role: 'viewer',
    });
    expect(parseLiveRoom(liveRoom({}, 'admin'))).toEqual({ scope: 'all', role: 'admin' });
    expect(parseLiveRoom('Xk3_socket-id')).toBeNull();
    expect(parseLiveRoom(':admin')).toBeNull();
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
    expect(() =>
      resolveTimeWindow(
        { range: 'custom', from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
        now,
      ),
    ).toThrow(TimeWindowError);
    expect(() => resolveTimeWindow({ range: '90d' }, now, 31 * 86_400_000)).toThrow(/too large/);
  });

  it('tags refusals with a reason (tooLarge → RANGE_TOO_LARGE in the API)', () => {
    const reasonOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err instanceof TimeWindowError ? err.reason : 'not a TimeWindowError';
      }
      return 'did not throw';
    };
    expect(reasonOf(() => resolveTimeWindow({ range: '90d' }, now, 31 * 86_400_000))).toBe(
      'tooLarge',
    );
    expect(
      reasonOf(() =>
        resolveTimeWindow(
          { range: 'custom', from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
          now,
        ),
      ),
    ).toBe('invalid');
  });

  it('query schema defaults range and requires from/to for custom', () => {
    expect(timeWindowQuerySchema.parse({}).range).toBe('24h');
    expect(timeWindowQuerySchema.safeParse({ range: 'custom' }).success).toBe(false);
    const q = endpointListQuerySchema.parse({ limit: '20', sort: 'p95' });
    expect(q).toMatchObject({ limit: 20, sort: 'p95', dir: 'desc', range: '24h' });
  });
});

describe('Phase A contract invariants', () => {
  it('the retry queue TTL keeps replays well inside the event clock window', () => {
    expect(SDK_DEFAULTS.browser.retryQueueTtlMs).toBeLessThan(EVENT_CLOCK_POLICY.maxBackdateMs / 2);
  });

  it('the environment filter is the environments plus all', () => {
    expect(ENVIRONMENT_FILTER_VALUES).toEqual([...ENVIRONMENT_VALUES, 'all']);
  });

  it('server breakdown dimensions are a subset of the browser ones', () => {
    const all = new Set<string>(BREAKDOWN_DIMENSION_VALUES);
    for (const d of SERVER_BREAKDOWN_DIMENSION_VALUES) expect(all.has(d), d).toBe(true);
  });

  it('kill and key-guess codes are real error codes; rejection codes extend the event codes', () => {
    const codes = new Set<string>(Object.values(ERROR_CODES));
    for (const c of [...SDK_KILL_ERROR_CODES, ...KEY_GUESS_ERROR_CODES]) expect(codes.has(c), c).toBe(true);
    expect(INGEST_REJECTION_CODE_VALUES.slice(0, INGEST_EVENT_REJECT_CODES.length)).toEqual([
      ...INGEST_EVENT_REJECT_CODES,
    ]);
    expect(new Set(INGEST_REJECTION_CODE_VALUES).size).toBe(INGEST_REJECTION_CODE_VALUES.length);
  });

  it('a policy denial is never counted as a key guess', () => {
    for (const c of [ERROR_CODES.APP_DISABLED, ERROR_CODES.BROWSER_INGEST_DISABLED, ERROR_CODES.ORIGIN_NOT_ALLOWED]) {
      expect((KEY_GUESS_ERROR_CODES as readonly string[]).includes(c), c).toBe(false);
    }
  });

  it('the IP failure limiter counts key guesses + ORIGIN_NOT_ALLOWED, never a kill code', () => {
    expect(IP_FAILURE_ERROR_CODES).toEqual([...KEY_GUESS_ERROR_CODES, ERROR_CODES.ORIGIN_NOT_ALLOWED]);
    for (const c of [ERROR_CODES.APP_DISABLED, ERROR_CODES.BROWSER_INGEST_DISABLED, ERROR_CODES.SECRET_KEY_EXPOSED]) {
      expect((IP_FAILURE_ERROR_CODES as readonly string[]).includes(c), c).toBe(false);
    }
  });

  it('lists the SSO outcomes once each, starting with ok', () => {
    const first: SsoCookieOutcome = 'ok';
    expect(SSO_COOKIE_OUTCOME_VALUES[0]).toBe(first);
    expect(new Set(SSO_COOKIE_OUTCOME_VALUES).size).toBe(SSO_COOKIE_OUTCOME_VALUES.length);
  });

  it('leaves env undefined when absent (the API applies prod) and rejects an unknown env', () => {
    expect(timeWindowQuerySchema.parse({}).env).toBeUndefined();
    expect(timeWindowQuerySchema.parse({ env: 'all' }).env).toBe('all');
    expect(timeWindowQuerySchema.safeParse({ env: 'production' }).success).toBe(false);
  });

  it('breakdown queries default to browser and refuse browser-only dimensions for server', () => {
    expect(breakdownOverviewQuerySchema.parse({ dimension: 'client_tz' })).toMatchObject({
      source: 'browser',
      limit: 10,
      range: '24h',
    });
    expect(breakdownOverviewQuerySchema.safeParse({ source: 'server', dimension: 'release' }).success).toBe(true);
    expect(breakdownOverviewQuerySchema.safeParse({ source: 'server', dimension: 'client_tz' }).success).toBe(false);
    expect(breakdownOverviewQuerySchema.safeParse({ dimension: 'nope' }).success).toBe(false);
  });

  it('sdk config updates need a version and refuse duplicate or unknown modules', () => {
    expect(updateSdkConfigBodySchema.safeParse({ expectedVersion: 1, disabledModules: [] }).success).toBe(true);
    expect(
      updateSdkConfigBodySchema.safeParse({ expectedVersion: 1, disabledModules: ['custom', 'custom'] }).success,
    ).toBe(false);
    expect(updateSdkConfigBodySchema.safeParse({ expectedVersion: 1, disabledModules: ['nope'] }).success).toBe(false);
    expect(updateSdkConfigBodySchema.safeParse({ expectedVersion: 0, disabledModules: [] }).success).toBe(false);
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
