/**
 * S2 + S3 end to end, in process: the REAL container (createContainer) and app (createApp) against a
 * fresh, migrated, seeded database, connected as nexus_app exactly like production, with a
 * FixedClock at the seed instant (see ../db/analytics-seed.ts).
 *
 * WHY: proves the dashboard wiring that unit tests cannot — ROUTES leaf → route table (ssoAuth +
 * X-Nexus-Dashboard + validateQuery/validateParams with the SHARED schemas, query defaults
 * included) → controller → service → SQL → JSON — and the one rule that must never break: a
 * non-admin viewer never receives an IP address, on any analytics route.
 */
import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  buildPath,
  ERROR_CODES,
  INGEST_HEADERS,
  ROUTES,
  type AppDto,
  type BreakdownDto,
  type CursorPage,
  type DeviceReturnDto,
  type EndpointDetailDto,
  type EndpointStatsDto,
  type ErrorSummaryDto,
  type FailedRequestDto,
  type GeoCountryDto,
  type IntegrationHealthDto,
  type OverviewSummaryDto,
  type OverviewTimeseriesDto,
  type PageDetailDto,
  type PageStatsDto,
  type PersonAccessEntryDto,
  type RouteDescriptor,
  type TimelineItemDto,
  type ToolDetailDto,
  type UserSummaryDto,
  type WindowedListDto,
} from '@nexus/shared';
import { toPageId, toToolId } from '@nexus/shared/endpoint-id';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../../src/app';
import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../../src/http/cache-control';
import { FixedClock } from '../../src/lib/clock';
import {
  ENDPOINT_IDS,
  EXPECTED,
  HR_SLUG,
  SALES_SLUG,
  seedAnalytics,
  SEEDED_IP,
  seedJourneys,
  USER_A,
  USER_B,
  userKeyHex,
  type AnalyticsSeed,
} from '../db/analytics-seed';
import { createTestDatabase, RUN_DB_TESTS, type TestDatabase } from '../db/test-database';
import { signAccessToken } from '../fixtures/sign-access-token';
import { silentLogger } from '../ingest-fixtures';

const JWT_SECRET = 'e2e-dashboard-jwt-secret-'.padEnd(48, 'x');

/** The admin-only person leaves (PERSON_ROUTE_LEAVES). */
const PERSON_ROUTES = [
  ROUTES.users.profile,
  ROUTES.users.timeline,
  ROUTES.users.devices,
  ROUTES.users.daily,
] as const;

const ADMIN_EMAIL = 'admin@libas.in';
const VIEWER_EMAIL = 'viewer@libas.in';

const url = (path: string) => `${API_MOUNT_PATH}${path}`;

function testConfig(databaseUrl: string) {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: databaseUrl,
    LIBAS_JWT_SECRET: JWT_SECRET,
    DASHBOARD_ADMIN_EMAILS: ADMIN_EMAIL,
    API_KEY_PEPPER: 'a'.repeat(64),
    USER_KEY_SECRET: 'b'.repeat(64),
    IP_HASH_SECRET: 'c'.repeat(64),
  });
}

/**
 * A portal access_token cookie for `email`, valid for an hour after `now`. The SSO reader checks
 * `exp` against the CONTAINER clock (the FixedClock at the seed instant), not the wall clock.
 */
function cookieFor(email: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + 3600;
  return `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email, type: 'access', exp }, JWT_SECRET)}`;
}

describe.skipIf(!RUN_DB_TESTS)('S2 e2e: dashboard analytics over HTTP (db)', () => {
  let db: TestDatabase;
  let container: Container;
  let app: Express;
  let seed: AnalyticsSeed;

  /** A signed dashboard GET (cookie + X-Nexus-Dashboard: 1). */
  function get(
    route: RouteDescriptor,
    email: string,
    query: Record<string, string> = {},
    path = route.path,
  ) {
    return request(app)
      .get(url(path))
      .query(query)
      .set('Cookie', cookieFor(email, seed.now))
      .set(INGEST_HEADERS.dashboard, '1');
  }

  beforeAll(async () => {
    db = await createTestDatabase('e2e_dashboard');
    seed = await seedAnalytics(db);
    container = createContainer(testConfig(db.appUrl), {
      logger: silentLogger(),
      clock: new FixedClock(seed.now),
    });
    app = createApp(container);
  });

  afterAll(async () => {
    if (container) {
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    }
    await db?.drop();
  });

  // ─── Guards ───────────────────────────────────────────────────────────────

  it('no cookie → 401; no X-Nexus-Dashboard header → 403 CSRF_HEADER_MISSING', async () => {
    const anonymous = await request(app)
      .get(url(ROUTES.overview.summary.path))
      .set(INGEST_HEADERS.dashboard, '1');
    expect(anonymous.status).toBe(401);

    const noHeader = await request(app)
      .get(url(ROUTES.overview.summary.path))
      .set('Cookie', cookieFor(VIEWER_EMAIL, seed.now));
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe(ERROR_CODES.CSRF_HEADER_MISSING);
  });

  // ─── Overview ─────────────────────────────────────────────────────────────

  it('overview.summary: defaults to 24h and returns the KPIs with deltas (private cache)', async () => {
    const res = await get(ROUTES.overview.summary, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    expect(res.headers[CACHE_CONTROL_HEADER.toLowerCase()]).toBe(DASHBOARD_ANALYTICS_CACHE);
    const body = res.body as OverviewSummaryDto;
    expect(body.window.grain).toBe('hour');
    expect(body.window.to).toBe(seed.now.toISOString());
    expect(body.requests).toEqual({
      value: EXPECTED.requests,
      previous: EXPECTED.previousRequests,
      deltaPct: 320,
    });
    expect(body.activeUsersNow).toBe(EXPECTED.activeUsersNow);
  });

  it('overview.summary: 90d → 400 RANGE_TOO_LARGE; unknown app → 404', async () => {
    const tooLarge = await get(ROUTES.overview.summary, VIEWER_EMAIL, { range: '90d' });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe(ERROR_CODES.RANGE_TOO_LARGE);

    const unknown = await get(ROUTES.overview.summary, VIEWER_EMAIL, { app: 'no-such-app' });
    expect(unknown.status).toBe(404);
  });

  it('overview.timeseries: a continuous 24-point hourly series', async () => {
    const res = await get(ROUTES.overview.timeseries, VIEWER_EMAIL, { range: '24h' });
    expect(res.status).toBe(200);
    const body = res.body as OverviewTimeseriesDto;
    expect(body.points).toHaveLength(24);
    expect(body.points.reduce((sum, p) => sum + p.requests, 0)).toBe(EXPECTED.requests);
  });

  // ─── API Routes ───────────────────────────────────────────────────────────

  it('endpoints.list: sorted, offset-paged, app-filtered; bad sort → 400', async () => {
    const first = await get(ROUTES.endpoints.list, VIEWER_EMAIL, { sort: 'calls', limit: '2' });
    expect(first.status).toBe(200);
    const page = first.body as CursorPage<EndpointStatsDto>;
    expect(page.items.map((i) => i.endpointId)).toEqual([
      ENDPOINT_IDS.storeLookup,
      ENDPOINT_IDS.leaveList,
    ]);
    const second = await get(ROUTES.endpoints.list, VIEWER_EMAIL, {
      sort: 'calls',
      limit: '2',
      cursor: page.nextCursor ?? '',
    });
    expect((second.body as CursorPage<EndpointStatsDto>).items.map((i) => i.endpointId)).toEqual([
      ENDPOINT_IDS.reportExport,
    ]);

    const hr = await get(ROUTES.endpoints.list, VIEWER_EMAIL, { app: HR_SLUG });
    expect((hr.body as CursorPage<EndpointStatsDto>).items).toHaveLength(1);

    const badSort = await get(ROUTES.endpoints.list, VIEWER_EMAIL, { sort: 'duration; DROP' });
    expect(badSort.status).toBe(400);
    expect(badSort.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('endpoints.detail: admins get the slowest calls (with the IP) and the callers', async () => {
    const path = buildPath(ROUTES.endpoints.detail, { endpointId: ENDPOINT_IDS.reportExport });
    const res = await get(ROUTES.endpoints.detail, ADMIN_EMAIL, {}, path);
    expect(res.status).toBe(200);
    const body = res.body as EndpointDetailDto;
    expect(body.endpoint.calls).toBe(EXPECTED.calls.reportExport);
    expect(Array.isArray(body.slowest)).toBe(true);
    expect(Array.isArray(body.topUsers)).toBe(true);
    expect(body.slowest?.[0]?.actor.ip).toBe(SEEDED_IP);
  });

  it('endpoints.detail: a non-admin gets slowest and topUsers null, NEVER an IP (ADR 0019)', async () => {
    const path = buildPath(ROUTES.endpoints.detail, { endpointId: ENDPOINT_IDS.reportExport });
    const res = await get(ROUTES.endpoints.detail, VIEWER_EMAIL, {}, path);
    expect(res.status).toBe(200);
    const body = res.body as EndpointDetailDto;
    expect(body.slowest).toBeNull();
    expect(body.topUsers).toBeNull();
    expect(body.endpoint.calls).toBe(EXPECTED.calls.reportExport);
    expect(body.uniqueUsers).toBeGreaterThanOrEqual(0);
    expect(res.text).not.toContain(SEEDED_IP);
  });

  it('endpoints.detail: malformed id → 400, no traffic → 404', async () => {
    const malformed = buildPath(ROUTES.endpoints.detail, { endpointId: 'not-a-uuid' });
    expect((await get(ROUTES.endpoints.detail, VIEWER_EMAIL, {}, malformed)).status).toBe(400);
    const silent = buildPath(ROUTES.endpoints.detail, {
      endpointId: '00000000-0000-5000-8000-000000000000',
    });
    expect((await get(ROUTES.endpoints.detail, VIEWER_EMAIL, {}, silent)).status).toBe(404);
  });

  // ─── Errors ───────────────────────────────────────────────────────────────

  it('errors.summary: totals by class', async () => {
    const res = await get(ROUTES.errors.summary, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    expect(res.body as ErrorSummaryDto).toMatchObject({
      total: EXPECTED.failures,
      errors4xx: EXPECTED.errors4xx,
      errors5xx: EXPECTED.errors5xx,
    });
  });

  it('errors.list: keyset pages over HTTP; admins see IPs, non-admins NEVER do', async () => {
    const collected: FailedRequestDto[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(ROUTES.errors.list, VIEWER_EMAIL, {
        limit: '4',
        ...(cursor ? { cursor } : {}),
      });
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(SEEDED_IP);
      const page = res.body as CursorPage<FailedRequestDto>;
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(collected.map((f) => f.eventId)).toEqual(seed.failureIds);
    expect(collected.every((f) => f.actor.ip === null)).toBe(true);

    const admin = await get(ROUTES.errors.list, ADMIN_EMAIL, { statusClass: '5xx' });
    const adminIps = (admin.body as CursorPage<FailedRequestDto>).items.map((f) => f.actor.ip);
    expect(adminIps).toContain(SEEDED_IP);
  });

  it('errors.list: a tampered cursor → 400', async () => {
    const res = await get(ROUTES.errors.list, VIEWER_EMAIL, { cursor: 'tampered' });
    expect(res.status).toBe(400);
  });

  // ─── S3: Users / Journeys / Pages & Tools / Geography ─────────────────────

  it('users.list: verified users over API calls + page views, most recently seen first', async () => {
    const res = await get(ROUTES.users.list, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    expect(res.headers[CACHE_CONTROL_HEADER.toLowerCase()]).toBe(DASHBOARD_ANALYTICS_CACHE);
    const page = res.body as CursorPage<UserSummaryDto>;
    expect(page.items).toMatchObject([
      { email: USER_A, userKey: userKeyHex(USER_A), requests: 10, pageViews: 1 },
      { email: USER_B, userKey: userKeyHex(USER_B), requests: 5, pageViews: 0 },
    ]);
  });

  it('person leaves are admin-only: a non-admin gets the 403 envelope, an admin gets 200', async () => {
    const path = (route: (typeof PERSON_ROUTES)[number]) =>
      buildPath(route, { userKey: userKeyHex(USER_A) });
    for (const route of PERSON_ROUTES) {
      const viewer = await get(route, VIEWER_EMAIL, {}, path(route));
      expect(viewer.status, route.path).toBe(403);
      expect(viewer.body).toMatchObject({ error: { code: ERROR_CODES.FORBIDDEN } });
      expect(JSON.stringify(viewer.body)).not.toContain(USER_A);
      expect((await get(route, ADMIN_EMAIL, {}, path(route))).status, route.path).toBe(200);
    }
    // The lists stay open to every viewer.
    expect((await get(ROUTES.users.list, VIEWER_EMAIL)).status).toBe(200);
    expect((await get(ROUTES.users.activity, VIEWER_EMAIL)).status).toBe(200);
  });

  it('users.profile / users.timeline: malformed key → 400, unknown user → 404', async () => {
    const malformed = buildPath(ROUTES.users.profile, { userKey: 'not-a-key' });
    expect((await get(ROUTES.users.profile, ADMIN_EMAIL, {}, malformed)).status).toBe(400);
    const unknown = buildPath(ROUTES.users.profile, { userKey: '0'.repeat(64) });
    expect((await get(ROUTES.users.profile, ADMIN_EMAIL, {}, unknown)).status).toBe(404);
  });

  it('users.devices / users.daily: malformed key → 400, unknown user → 200 with no rows', async () => {
    for (const route of [ROUTES.users.devices, ROUTES.users.daily]) {
      const malformed = buildPath(route, { userKey: 'not-a-key' });
      expect((await get(route, ADMIN_EMAIL, {}, malformed)).status).toBe(400);
      const unknown = buildPath(route, { userKey: '0'.repeat(64) });
      const res = await get(route, ADMIN_EMAIL, {}, unknown);
      expect(res.status).toBe(200);
      expect((res.body as { items: unknown[] }).items).toEqual([]);
    }
  });

  it('users.timeline: admins see the IP', async () => {
    const path = buildPath(ROUTES.users.timeline, { userKey: userKeyHex(USER_B) });
    const admin = await get(ROUTES.users.timeline, ADMIN_EMAIL, { limit: '50' }, path);
    expect(admin.status).toBe(200);
    const items = (admin.body as CursorPage<TimelineItemDto>).items;
    expect(items).toHaveLength(EXPECTED.calls.reportExport);
    expect(items.map((item) => item.ip)).toContain(SEEDED_IP);
  });

  it('privacy.accessLog: admin-only; lists the person opens above, masked, newest first', async () => {
    expect((await get(ROUTES.privacy.accessLog, VIEWER_EMAIL)).status).toBe(403);
    const res = await get(ROUTES.privacy.accessLog, ADMIN_EMAIL, {
      userKey: userKeyHex(USER_A),
    });
    expect(res.status).toBe(200);
    expect(res.headers[CACHE_CONTROL_HEADER.toLowerCase()]).toBe('no-store');
    const items = (res.body as CursorPage<PersonAccessEntryDto>).items;
    expect(items.map((item) => item.surface).sort()).toEqual([
      'person_daily',
      'person_devices',
      'person_profile',
      'person_timeline',
    ]);
    expect(items.every((item) => item.viewerEmail === ADMIN_EMAIL)).toBe(true);
    expect(items.every((item) => item.subjectEmailMasked === 'a***@libas.in')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(USER_A);
    expect((await get(ROUTES.privacy.accessLog, ADMIN_EMAIL, { cursor: 'bad' })).status).toBe(400);
  });

  it('journeys: sessions list for a viewer; malformed session id → 400, unknown → 404', async () => {
    const sessions = await get(ROUTES.journeys.sessions, VIEWER_EMAIL);
    expect(sessions.status).toBe(200);
    expect(JSON.stringify(sessions.body)).not.toContain(SEEDED_IP);

    const bad = buildPath(ROUTES.journeys.session, { app: SALES_SLUG, sessionId: 'nope' });
    expect((await get(ROUTES.journeys.session, VIEWER_EMAIL, {}, bad)).status).toBe(400);
    const unknown = buildPath(ROUTES.journeys.session, {
      app: SALES_SLUG,
      sessionId: '00000000-0000-4000-8000-000000000000',
    });
    expect((await get(ROUTES.journeys.session, VIEWER_EMAIL, {}, unknown)).status).toBe(404);
    expect((await get(ROUTES.journeys.topPaths, VIEWER_EMAIL)).status).toBe(200);
  });

  it('pages.list + tools.usage: page views per template; no tools yet → empty list', async () => {
    const pages = await get(ROUTES.pages.list, VIEWER_EMAIL);
    expect(pages.status).toBe(200);
    expect((pages.body as WindowedListDto<PageStatsDto>).items).toMatchObject([
      { app: SALES_SLUG, pathTemplate: '/home', views: 2 },
      { app: HR_SLUG, pathTemplate: '/home', views: 1 },
    ]);
    const tools = await get(ROUTES.tools.usage, VIEWER_EMAIL);
    expect(tools.status).toBe(200);
    expect(tools.body).toMatchObject({ items: [], window: { grain: 'hour' } });
  });

  it('geo.countries: every request and page view of the window is counted once', async () => {
    const res = await get(ROUTES.geo.countries, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    const items = (res.body as WindowedListDto<GeoCountryDto>).items;
    expect(items.reduce((sum, c) => sum + c.requests, 0)).toBe(EXPECTED.requests);
    expect(items.reduce((sum, c) => sum + c.pageViews, 0)).toBe(EXPECTED.pageViews);
    expect((await get(ROUTES.geo.cities, VIEWER_EMAIL, { limit: '1000' })).status).toBe(400);
  });

  // ─── Phase A: env filter, breakdowns, devices, SDK config, Integration Health ─

  /** A signed admin-or-viewer PATCH with a JSON body (cookie + X-Nexus-Dashboard: 1). */
  function patch(path: string, email: string, body: unknown) {
    return request(app)
      .patch(url(path))
      .set('Cookie', cookieFor(email, seed.now))
      .set(INGEST_HEADERS.dashboard, '1')
      .send(body as object);
  }

  it('overview.summary: env narrows every KPI (default prod); an unknown env → 400', async () => {
    const staging = await get(ROUTES.overview.summary, VIEWER_EMAIL, { env: 'staging' });
    expect(staging.status).toBe(200);
    expect((staging.body as OverviewSummaryDto).requests.value).toBe(EXPECTED.stagingRequests);
    const all = await get(ROUTES.overview.summary, VIEWER_EMAIL, { env: 'all' });
    expect((all.body as OverviewSummaryDto).requests.value).toBe(
      EXPECTED.requests + EXPECTED.stagingRequests,
    );
    const bad = await get(ROUTES.overview.summary, VIEWER_EMAIL, { env: 'qa' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it('overview.breakdown: top values with shares (private cache); server-only dimensions enforced', async () => {
    const res = await get(ROUTES.overview.breakdown, VIEWER_EMAIL, { dimension: 'client_tz' });
    expect(res.status).toBe(200);
    expect(res.headers[CACHE_CONTROL_HEADER.toLowerCase()]).toBe(DASHBOARD_ANALYTICS_CACHE);
    const body = res.body as BreakdownDto;
    expect(body).toMatchObject({ source: 'browser', dimension: 'client_tz', total: 3 });
    expect(body.items[0]).toEqual({ value: 'Asia/Kolkata', events: 2, share: 0.6667 });

    const server = await get(ROUTES.overview.breakdown, VIEWER_EMAIL, {
      source: 'server',
      dimension: 'environment',
      env: 'all',
    });
    expect((server.body as BreakdownDto).total).toBe(EXPECTED.requests + EXPECTED.stagingRequests);

    const refused = await get(ROUTES.overview.breakdown, VIEWER_EMAIL, {
      source: 'server',
      dimension: 'nav',
    });
    expect(refused.status).toBe(400);
    expect((await get(ROUTES.overview.breakdown, VIEWER_EMAIL)).status).toBe(400);
  });

  it('overview.devices: new vs returning devices over the bounded lookback', async () => {
    const res = await get(ROUTES.overview.devices, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    expect(res.body as DeviceReturnDto).toMatchObject({
      devices: EXPECTED.devices.devices,
      newDevices: EXPECTED.devices.new,
      returningDevices: EXPECTED.devices.returning,
    });
  });

  it('apps.updateSdkConfig: admin only, optimistic version (409 when stale), listed afterwards', async () => {
    const path = buildPath(ROUTES.apps.updateSdkConfig, { slug: SALES_SLUG });
    const body = { expectedVersion: 1, disabledModules: ['retry_queue'] };

    const asViewer = await patch(path, VIEWER_EMAIL, body);
    expect(asViewer.status).toBe(403);

    const invalid = await patch(path, ADMIN_EMAIL, { expectedVersion: 1, disabledModules: ['x'] });
    expect(invalid.status).toBe(400);

    const ok = await patch(path, ADMIN_EMAIL, body);
    expect(ok.status).toBe(200);
    expect((ok.body as AppDto).sdkConfig).toMatchObject({
      version: 2,
      disabledModules: ['retry_queue'],
    });

    const stale = await patch(path, ADMIN_EMAIL, body);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe(ERROR_CODES.CONFLICT);

    const listed = await get(ROUTES.apps.list, VIEWER_EMAIL);
    const sales = (listed.body as AppDto[]).find((item) => item.slug === SALES_SLUG);
    expect(sales?.sdkConfig.version).toBe(2);
  });

  it('integration.health: coverage, environment mix (NOT env-filtered) and a level per app', async () => {
    const res = await get(ROUTES.integration.health, VIEWER_EMAIL);
    expect(res.status).toBe(200);
    const sales = (res.body as IntegrationHealthDto).apps.find((item) => item.app === SALES_SLUG);
    expect(sales?.environments).toEqual(
      expect.arrayContaining([
        { source: 'server', environment: 'staging', events: EXPECTED.stagingRequests },
        { source: 'browser', environment: 'dev', events: EXPECTED.devPageViews },
      ]),
    );
    expect(sales?.identityCoverage.map((coverage) => coverage.source)).toEqual([
      'server',
      'browser',
    ]);
    expect(sales?.level).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain(SEEDED_IP);
  });
});

/**
 * ADR 0019 over HTTP: pages.detail and tools.detail send the people (topUsers) to admins only. The
 * journeys seed has a page (/home) and a feature (export-csv) of ebo-sales, both used by USER_A.
 */
describe.skipIf(!RUN_DB_TESTS)('B8-3 e2e: object pages send people to admins only (db)', () => {
  let db: TestDatabase;
  let container: Container;
  let app: Express;
  let now: Date;

  /** A signed dashboard GET (cookie + X-Nexus-Dashboard: 1) over the last 24 hours. */
  function get(email: string, path: string) {
    return request(app)
      .get(url(path))
      .query({ range: '24h' })
      .set('Cookie', cookieFor(email, now))
      .set(INGEST_HEADERS.dashboard, '1');
  }

  beforeAll(async () => {
    db = await createTestDatabase('e2e_object_people');
    now = (await seedJourneys(db)).now;
    container = createContainer(testConfig(db.appUrl), {
      logger: silentLogger(),
      clock: new FixedClock(now),
    });
    app = createApp(container);
  });

  afterAll(async () => {
    if (container) {
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    }
    await db?.drop();
  });

  const pagePath = () =>
    buildPath(ROUTES.pages.detail, { app: SALES_SLUG, pageId: toPageId(SALES_SLUG, '/home') });
  const toolPath = () =>
    buildPath(ROUTES.tools.detail, {
      app: SALES_SLUG,
      toolId: toToolId(SALES_SLUG, 'export-csv'),
    });

  it('pages.detail: an admin gets the viewers, a viewer gets null and no email', async () => {
    const admin = await get(ADMIN_EMAIL, pagePath());
    expect(admin.status).toBe(200);
    const adminBody = admin.body as PageDetailDto;
    expect(Array.isArray(adminBody.topUsers)).toBe(true);
    expect(adminBody.topUsers?.map((user) => user.email)).toContain(USER_A);

    const viewer = await get(VIEWER_EMAIL, pagePath());
    expect(viewer.status).toBe(200);
    const viewerBody = viewer.body as PageDetailDto;
    expect(viewerBody.topUsers).toBeNull();
    expect(viewerBody.page).toEqual(adminBody.page);
    expect(viewer.text).not.toContain(USER_A);
  });

  it('tools.detail: an admin gets the users, a viewer gets null and no email', async () => {
    const admin = await get(ADMIN_EMAIL, toolPath());
    expect(admin.status).toBe(200);
    const adminBody = admin.body as ToolDetailDto;
    expect(Array.isArray(adminBody.topUsers)).toBe(true);
    expect(adminBody.topUsers?.map((user) => user.email)).toContain(USER_A);

    const viewer = await get(VIEWER_EMAIL, toolPath());
    expect(viewer.status).toBe(200);
    const viewerBody = viewer.body as ToolDetailDto;
    expect(viewerBody.topUsers).toBeNull();
    expect(viewerBody.tool).toEqual(adminBody.tool);
    expect(viewer.text).not.toContain(USER_A);
  });
});
