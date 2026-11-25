import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_FILTER_VALUES,
  ENVIRONMENT_VALUES,
  EVENT_CLOCK_POLICY,
  BREAKDOWN_DIMENSION_VALUES,
  MAX_COUNT_RANGE_MS,
  PERSON_ACCESS_COALESCE_MS,
  PERSON_ACCESS_SURFACE_VALUES,
  type PersonAccessSurface,
  SDK_DEFAULTS,
  SERVER_BREAKDOWN_DIMENSION_VALUES,
  SSO_COOKIE_OUTCOME_VALUES,
  type SsoCookieOutcome,
  USER_DAILY_APP_ROWS_LIMIT,
  USER_DAY_BLOCK_GAP_MS,
  USER_DAY_BLOCKS_LIMIT,
  USER_DAY_LOOKBACK_DAYS,
  USER_DAY_PAGES_LIMIT,
  USER_DAY_TOOLS_LIMIT,
  USER_DAY_VISITS_LIMIT,
  VISIBLE_DELTA_CREDIT_CAP_MS,
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
  PERSON_FILTERED_ROUTE_LEAVES,
  PERSON_ROUTE_LEAVES,
  ROUTES,
} from './routes';
import {
  breakdownOverviewQuerySchema,
  endpointListQuerySchema,
  errorListQuerySchema,
  errorSummaryQuerySchema,
  liveOnlineQuerySchema,
  sessionListQuerySchema,
  privacyAccessLogQuerySchema,
  timeWindowQuerySchema,
  updateSdkConfigBodySchema,
} from './schemas';
import {
  grainFor,
  resolveTimeWindow,
  startOfReportingDay,
  TimeWindowError,
  wholeReportingDays,
} from './time-window';

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
    expect(ROUTES.apps.updateSdkConfig).toEqual({
      method: 'PATCH',
      path: '/v1/apps/:slug/sdk-config',
    });
    expect(ROUTES.overview.breakdown).toEqual({ method: 'GET', path: '/v1/overview/breakdown' });
    expect(ROUTES.overview.devices).toEqual({ method: 'GET', path: '/v1/overview/devices' });
    expect(PENDING_ROUTE_LEAVES).toEqual([]);
  });

  it('serves the person leaves under /v1/users/:userKey', () => {
    expect(ROUTES.users.devices).toEqual({ method: 'GET', path: '/v1/users/:userKey/devices' });
    expect(ROUTES.users.daily).toEqual({ method: 'GET', path: '/v1/users/:userKey/daily' });
    expect(buildPath(ROUTES.users.daily, { userKey: 'ab' })).toBe('/v1/users/ab/daily');
    expect(ROUTES.users.day).toEqual({ method: 'GET', path: '/v1/users/:userKey/day' });
  });

  it('names the person-level leaves (admin-only, access-logged): one surface each', () => {
    const known = new Set(listRoutes().map(({ group, leaf }) => `${group}.${leaf}`));
    for (const id of PERSON_ROUTE_LEAVES) expect(known.has(id), id).toBe(true);
    for (const id of PERSON_ROUTE_LEAVES) {
      const [, leaf] = id.split('.') as [string, keyof typeof ROUTES.users];
      expect(ROUTES.users[leaf].path).toMatch(/^\/v1\/users\/:userKey(\/[a-z]+)?$/);
    }
    // One per person leaf, + person_visits and person_failures (the lists narrowed to one person by
    // ?userKey=), + the ADR 0017 surfaces: one day (users.day), usual activity hours (its leaf comes
    // in a later step) and the visit steps of a verified person (journeys.session, guarded by data).
    expect(PERSON_ACCESS_SURFACE_VALUES).toEqual([
      'person_profile',
      'person_timeline',
      'person_devices',
      'person_daily',
      'person_visits',
      'person_failures',
      'person_day',
      'person_pattern',
      'person_visit_steps',
    ]);
    // Each person leaf has its own surface (the Record makes a new leaf without one a type error).
    // What is left is exactly: the two narrowed lists, the visit steps of a verified person, and the
    // surface of the person leaf still to come (users.pattern in step 6; move it into
    // SURFACE_OF_LEAF when its leaf lands).
    const SURFACE_OF_LEAF: Record<(typeof PERSON_ROUTE_LEAVES)[number], PersonAccessSurface> = {
      'users.profile': 'person_profile',
      'users.timeline': 'person_timeline',
      'users.devices': 'person_devices',
      'users.daily': 'person_daily',
      'users.day': 'person_day',
    };
    const SURFACES_OF_LEAVES_TO_COME: PersonAccessSurface[] = ['person_pattern'];
    const leafSurfaces: PersonAccessSurface[] = PERSON_ROUTE_LEAVES.map(
      (id) => SURFACE_OF_LEAF[id],
    );
    expect(new Set(leafSurfaces).size).toBe(PERSON_ROUTE_LEAVES.length);
    for (const surface of leafSurfaces) expect(PERSON_ACCESS_SURFACE_VALUES).toContain(surface);
    expect(
      PERSON_ACCESS_SURFACE_VALUES.filter((surface) => !leafSurfaces.includes(surface)).sort(),
    ).toEqual(
      [
        'person_visits',
        'person_failures',
        'person_visit_steps',
        ...SURFACES_OF_LEAVES_TO_COME,
      ].sort(),
    );
    for (const id of PERSON_FILTERED_ROUTE_LEAVES) expect(known.has(id), id).toBe(true);
    const narrowable = [
      sessionListQuerySchema,
      errorSummaryQuerySchema,
      errorListQuerySchema,
      liveOnlineQuerySchema,
    ];
    for (const schema of narrowable) {
      expect(schema.safeParse({ userKey: 'a'.repeat(64) }).success).toBe(true);
    }
    expect(PERSON_ACCESS_COALESCE_MS).toBe(10 * 60 * 1000);
  });

  it('serves the access log at /v1/privacy/access-log, filtered by an opaque key only', () => {
    expect(ROUTES.privacy.accessLog).toEqual({ method: 'GET', path: '/v1/privacy/access-log' });
    expect(privacyAccessLogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(privacyAccessLogQuerySchema.safeParse({ userKey: 'a'.repeat(64) }).success).toBe(true);
    expect(privacyAccessLogQuerySchema.safeParse({ userKey: 'someone@libas.in' }).success).toBe(
      false,
    );
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

  it('resolves today as the IST calendar day, compared with yesterday', () => {
    // 10:00Z = 15:30 IST on 1 Oct → 1 Oct 00:00 IST (30 Sep 18:30Z) up to 2 Oct 00:00 IST.
    const w = resolveTimeWindow({ range: 'today' }, now);
    expect(w.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-01T18:30:00.000Z');
    expect(w.previousFrom.toISOString()).toBe('2026-09-29T18:30:00.000Z');
    expect(w.grain).toBe('hour');
    // The day is not over: data ends now, and it is compared with yesterday up to the same time.
    expect(w.elapsedTo.toISOString()).toBe(now.toISOString());
    expect(w.previousTo.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    // 23:59 IST still belongs to the same day; 00:00 IST starts the next one.
    const lateEvening = resolveTimeWindow({ range: 'today' }, new Date('2026-10-01T18:29:59Z'));
    expect(lateEvening.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    const midnight = resolveTimeWindow({ range: 'today' }, new Date('2026-10-01T18:30:00Z'));
    expect(midnight.from.toISOString()).toBe('2026-10-01T18:30:00.000Z');
  });

  it('compares a running window with the same elapsed span, a finished one with the whole one', () => {
    // 04:30Z = 10:00 IST: today 00:00-10:00 IST vs yesterday 00:00-10:00 IST.
    const midDay = resolveTimeWindow({ range: 'today' }, new Date('2026-10-01T04:30:00Z'));
    expect(midDay.previousFrom.toISOString()).toBe('2026-09-29T18:30:00.000Z');
    expect(midDay.previousTo.toISOString()).toBe('2026-09-30T04:30:00.000Z');
    expect(midDay.durationMs).toBe(86_400_000);
    const rolling = resolveTimeWindow({ range: '24h' }, now);
    expect(rolling.elapsedTo.toISOString()).toBe(now.toISOString());
    expect(rolling.previousTo.toISOString()).toBe(rolling.from.toISOString());
    const past = resolveTimeWindow(
      { range: 'custom', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' },
      now,
    );
    expect(past.elapsedTo.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(past.previousTo.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('widens a window to whole IST days', () => {
    // 24h ending 15:30 IST 1 Oct → 30 Sep 00:00 IST up to 2 Oct 00:00 IST.
    const days = wholeReportingDays(resolveTimeWindow({ range: '24h' }, now));
    expect(days.from.toISOString()).toBe('2026-09-29T18:30:00.000Z');
    expect(days.to.toISOString()).toBe('2026-10-01T18:30:00.000Z');
    // Already whole days: unchanged (`to` is exclusive).
    const whole = { from: new Date('2026-09-28T18:30:00Z'), to: new Date('2026-09-30T18:30:00Z') };
    expect(wholeReportingDays(whole)).toEqual(whole);
    expect(startOfReportingDay(new Date('2026-09-30T18:29:59Z')).toISOString()).toBe(
      '2026-09-29T18:30:00.000Z',
    );
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

  it('the per-app daily row cap leaves room for every day of the widest window × many apps', () => {
    const widestDays = Math.ceil(MAX_COUNT_RANGE_MS / 86_400_000) + 1;
    expect(Number.isInteger(USER_DAILY_APP_ROWS_LIMIT)).toBe(true);
    expect(USER_DAILY_APP_ROWS_LIMIT).toBeGreaterThanOrEqual(widestDays * 30);
  });

  it('the one-day view joins breaks under 5 min, caps its lists and looks back about 6 months', () => {
    expect(USER_DAY_BLOCK_GAP_MS).toBe(5 * 60_000);
    // A block every 15 min of a whole day still fits.
    expect(USER_DAY_BLOCKS_LIMIT).toBe(86_400_000 / (15 * 60_000));
    expect([USER_DAY_PAGES_LIMIT, USER_DAY_TOOLS_LIMIT, USER_DAY_VISITS_LIMIT]).toEqual([
      30, 30, 50,
    ]);
    // Longer than the widest counted range (93 days), so a day the daily list shows always opens.
    expect(USER_DAY_LOOKBACK_DAYS).toBe(183);
    expect(USER_DAY_LOOKBACK_DAYS * 86_400_000).toBeGreaterThan(MAX_COUNT_RANGE_MS);
  });

  it('a page_time delta is credited at most 12 browser flush ticks (60 s, ADR 0017)', () => {
    expect(VISIBLE_DELTA_CREDIT_CAP_MS).toBe(60_000);
    expect(VISIBLE_DELTA_CREDIT_CAP_MS).toBe(12 * SDK_DEFAULTS.browser.flushIntervalMs);
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
    for (const c of [...SDK_KILL_ERROR_CODES, ...KEY_GUESS_ERROR_CODES])
      expect(codes.has(c), c).toBe(true);
    expect(INGEST_REJECTION_CODE_VALUES.slice(0, INGEST_EVENT_REJECT_CODES.length)).toEqual([
      ...INGEST_EVENT_REJECT_CODES,
    ]);
    expect(new Set(INGEST_REJECTION_CODE_VALUES).size).toBe(INGEST_REJECTION_CODE_VALUES.length);
  });

  it('a policy denial is never counted as a key guess', () => {
    for (const c of [
      ERROR_CODES.APP_DISABLED,
      ERROR_CODES.BROWSER_INGEST_DISABLED,
      ERROR_CODES.ORIGIN_NOT_ALLOWED,
    ]) {
      expect((KEY_GUESS_ERROR_CODES as readonly string[]).includes(c), c).toBe(false);
    }
  });

  it('the IP failure limiter counts key guesses + ORIGIN_NOT_ALLOWED, never a kill code', () => {
    expect(IP_FAILURE_ERROR_CODES).toEqual([
      ...KEY_GUESS_ERROR_CODES,
      ERROR_CODES.ORIGIN_NOT_ALLOWED,
    ]);
    for (const c of [
      ERROR_CODES.APP_DISABLED,
      ERROR_CODES.BROWSER_INGEST_DISABLED,
      ERROR_CODES.SECRET_KEY_EXPOSED,
    ]) {
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
    expect(
      breakdownOverviewQuerySchema.safeParse({ source: 'server', dimension: 'release' }).success,
    ).toBe(true);
    expect(
      breakdownOverviewQuerySchema.safeParse({ source: 'server', dimension: 'client_tz' }).success,
    ).toBe(false);
    expect(breakdownOverviewQuerySchema.safeParse({ dimension: 'nope' }).success).toBe(false);
  });

  it('sdk config updates need a version and refuse duplicate or unknown modules', () => {
    expect(
      updateSdkConfigBodySchema.safeParse({ expectedVersion: 1, disabledModules: [] }).success,
    ).toBe(true);
    expect(
      updateSdkConfigBodySchema.safeParse({
        expectedVersion: 1,
        disabledModules: ['custom', 'custom'],
      }).success,
    ).toBe(false);
    expect(
      updateSdkConfigBodySchema.safeParse({ expectedVersion: 1, disabledModules: ['nope'] })
        .success,
    ).toBe(false);
    expect(
      updateSdkConfigBodySchema.safeParse({ expectedVersion: 0, disabledModules: [] }).success,
    ).toBe(false);
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
