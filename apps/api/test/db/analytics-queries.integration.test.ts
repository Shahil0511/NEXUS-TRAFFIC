/**
 * S2 + S3 read side against a real, migrated database: ApiRequestQueryRepository and
 * WebEventQueryRepository through the Overview / Endpoint / Error services (S2, `seedAnalytics`) and
 * the User / Journey / Page / Tool / Geo services (S3, `seedJourneys`, its own database), connected
 * as nexus_app on a READ-ONLY query pool (exactly the runtime options of src/db/pool.ts
 * createQueryPool).
 *
 * WHY: the unit suites prove SQL shape and service orchestration with fakes; only PostgreSQL can
 * prove the numbers — counts, error rate, percentile_cont, IST bucket alignment, window bounds,
 * ordering and both kinds of pagination. The dataset is described in ./analytics-seed.ts.
 */
import { toPageId, toToolId } from '@nexus/shared/endpoint-id';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACTIVE_USER_WINDOW_MS,
  breakdownOverviewQuerySchema,
  ERROR_CODES,
  type EndpointStatsDto,
  type FailedRequestDto,
  type TimelineItemDto,
} from '@nexus/shared';

import { createQueryPool } from '../../src/db/pool';
import type { Viewer } from '../../src/domain/viewer';
import { FixedClock } from '../../src/lib/clock';
import { ApiRequestIngestRepository } from '../../src/repositories/api-request-ingest.repository';
import { ApiRequestQueryRepository } from '../../src/repositories/api-request-query.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { PersonAccessLogRepository } from '../../src/repositories/person-access-log.repository';
import { WebEventQueryRepository } from '../../src/repositories/web-event-query.repository';
import { AppSlugResolver } from '../../src/services/app-slug.resolver';
import { EndpointService } from '../../src/services/endpoint.service';
import { ErrorService } from '../../src/services/error.service';
import { GeoService } from '../../src/services/geo.service';
import { JourneyService } from '../../src/services/journey.service';
import { LiveService } from '../../src/services/live.service';
import { OverviewService } from '../../src/services/overview.service';
import { PageService } from '../../src/services/page.service';
import { PersonAccessRecorder } from '../../src/services/person-access.recorder';
import { PrivacyService } from '../../src/services/privacy.service';
import { ToolService } from '../../src/services/tool.service';
import { UserService } from '../../src/services/user.service';
import {
  API_RELEASE,
  BENGALURU,
  CLAIMED_EMAIL,
  ENDPOINT_IDS,
  EXPECTED,
  HR_SLUG,
  HTTP_DURATIONS,
  JOURNEY_EXPECTED,
  microsecondBlockAt,
  MUMBAI,
  percentileCont,
  RELEASE_R1,
  ROUTE,
  SALES_SLUG,
  seedAnalytics,
  SEEDED_IP,
  seedJourneys,
  USER_A,
  USER_B,
  userKeyHex,
  type AnalyticsSeed,
  type JourneySeed,
} from './analytics-seed';
import { FakePersonAccess } from '../fixtures/fake-query-repositories';
import { apiRequestRow, sha256 } from './fixtures';
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Hand-built repository filters see prod only, like every dashboard read by default. */
const PROD = ['prod'] as const;
const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const VIEWER: Viewer = { email: 'viewer@libas.in', isAdmin: false };

/** Every percentile in a DTO is rounded to 2 decimals (src/domain/numbers.ts). */
const expectMs = (actual: number | null, expected: number) =>
  expect(actual).toBeCloseTo(expected, 2);

describe.skipIf(!RUN_DB_TESTS)('analytics queries as nexus_app on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let seed: AnalyticsSeed;
  let requests: ApiRequestQueryRepository;
  let overview: OverviewService;
  let endpoints: EndpointService;
  let errors: ErrorService;

  beforeAll(async () => {
    db = await createTestDatabase('analytics');
    seed = await seedAnalytics(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    requests = new ApiRequestQueryRepository(queryPool);
    const webEvents = new WebEventQueryRepository(queryPool);
    const appSlugs = new AppSlugResolver(new AppRepository(queryPool));
    const clock = new FixedClock(seed.now);
    overview = new OverviewService(
      requests,
      webEvents,
      new AppRepository(queryPool),
      appSlugs,
      clock,
    );
    endpoints = new EndpointService(requests, appSlugs, clock);
    errors = new ErrorService(
      requests,
      appSlugs,
      clock,
      new FakePersonAccess() as unknown as PersonAccessRecorder,
    );
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  // ─── Overview ─────────────────────────────────────────────────────────────

  describe('OverviewService.summary', () => {
    it('counts requests, error rate, p95 (http only) and identified users, with previous-window deltas', async () => {
      const dto = await overview.summary({ range: '24h' });
      const allHttp = Object.values(HTTP_DURATIONS).flat();

      expect(dto.requests).toEqual({
        value: EXPECTED.requests,
        previous: EXPECTED.previousRequests,
        deltaPct: 320,
      });
      expect(dto.errorRate.value).toBeCloseTo((EXPECTED.failures / EXPECTED.requests) * 100, 2);
      expect(dto.errorRate.previous).toBe(0);
      expect(dto.errorRate.deltaPct).toBeNull();
      // The 600 000 ms stream is excluded from latency: p95 stays far below it.
      expectMs(dto.p95Ms.value, percentileCont(allHttp, 0.95));
      expectMs(dto.p95Ms.previous, 10);
      expect(dto.identifiedUsers).toEqual({
        value: EXPECTED.identifiedUsers,
        previous: EXPECTED.previousIdentifiedUsers,
        deltaPct: 100,
      });
      expect(dto.pageViews).toEqual({
        value: EXPECTED.pageViews,
        previous: EXPECTED.previousPageViews,
        deltaPct: 200,
      });
      expect(dto.activeUsersNow).toBe(EXPECTED.activeUsersNow);
      expect(dto.window).toEqual({
        from: new Date(seed.now.getTime() - 24 * HOUR).toISOString(),
        to: seed.now.toISOString(),
        grain: 'hour',
      });
    });

    it('scopes every KPI to one app', async () => {
      const hr = await overview.summary({ range: '24h', app: HR_SLUG });
      expect(hr.requests.value).toBe(EXPECTED.calls.leaveList);
      expect(hr.errorRate.value).toBe(50);
      expect(hr.identifiedUsers.value).toBe(0);
      expect(hr.pageViews.value).toBe(1);
      expect(hr.activeUsersNow).toBe(1);

      const sales = await overview.summary({ range: '24h', app: SALES_SLUG });
      expect(sales.requests.value).toBe(EXPECTED.calls.storeLookup + EXPECTED.calls.reportExport);
      expect(sales.requests.previous).toBe(EXPECTED.previousRequests);
    });

    it('refuses 90 days (percentiles) with RANGE_TOO_LARGE', async () => {
      await expect(overview.summary({ range: '90d' })).rejects.toMatchObject({
        code: ERROR_CODES.RANGE_TOO_LARGE,
      });
    });
  });

  describe('OverviewService.apps', () => {
    it('one row per registered app whose numbers match the scoped Overview', async () => {
      const dto = await overview.apps({ range: '24h' });
      const bySlug = new Map(dto.items.map((item) => [item.app, item]));
      for (const slug of [SALES_SLUG, HR_SLUG]) {
        const scoped = await overview.summary({ range: '24h', app: slug });
        expect(bySlug.get(slug)?.requests).toEqual(scoped.requests);
        expect(bySlug.get(slug)?.errorRate).toEqual(scoped.errorRate);
        expect(bySlug.get(slug)?.pageViews).toEqual(scoped.pageViews);
        expect(bySlug.get(slug)?.users).toEqual(scoped.identifiedUsers);
      }
      expect(bySlug.get(HR_SLUG)?.errorRate.value).toBe(50);
    });

    it('narrows to the app filter', async () => {
      const dto = await overview.apps({ range: '24h', app: HR_SLUG });
      expect(dto.items.map((item) => item.app)).toEqual([HR_SLUG]);
    });
  });

  describe('OverviewService.timeseries', () => {
    it('returns 24 IST-aligned hour buckets with the seeded counts and zeros elsewhere', async () => {
      const { points, window } = await overview.timeseries({ range: '24h' });
      expect(window.grain).toBe('hour');
      expect(points).toHaveLength(24);
      // IST is +05:30, so every hour bucket starts at :30 UTC.
      for (const point of points) expect(point.bucket).toMatch(/T\d{2}:30:00\.000Z$/);

      const at = (hoursBeforeNow: number) =>
        points.find(
          (p) => p.bucket === new Date(seed.now.getTime() - hoursBeforeNow * HOUR).toISOString(),
        );
      expect(at(1)).toMatchObject({ requests: 6, errors4xx: 2, errors5xx: 1, pageViews: 2 });
      expect(at(2)).toMatchObject({ requests: 10, errors4xx: 0, errors5xx: 0 });
      expectMs(at(2)?.p95Ms ?? null, percentileCont(HTTP_DURATIONS.storeLookup, 0.95));
      expect(at(3)).toMatchObject({ requests: 0, pageViews: 1, p95Ms: null });
      expect(at(5)).toMatchObject({ requests: 5, errors4xx: 1, errors5xx: 2 });
      expectMs(at(5)?.p95Ms ?? null, percentileCont(HTTP_DURATIONS.reportExport, 0.95));

      const total = points.reduce((sum, p) => sum + p.requests, 0);
      expect(total).toBe(EXPECTED.requests);
    });

    it('day buckets start at IST midnight (18:30 UTC the day before)', async () => {
      const rows = await requests.timeseries(
        { from: new Date(seed.now.getTime() - 24 * HOUR), to: seed.now, environments: PROD },
        'day',
      );
      const istMidnight = new Date(seed.now.getTime() - 12 * HOUR); // now is 12:00 IST
      expect(rows.map((r) => r.bucket.toISOString())).toEqual([istMidnight.toISOString()]);
      expect(rows[0]?.requests).toBe(EXPECTED.requests);
    });
  });

  // ─── Phase A: environment, linking, breakdowns, devices ─────────────────

  describe('environment filter (ADR 0008)', () => {
    it('defaults to prod: the staging calls and the dev page view never reach the KPIs', async () => {
      const prod = await overview.summary({ range: '24h' });
      expect(prod.requests.value).toBe(EXPECTED.requests);
      expect(prod.pageViews.value).toBe(EXPECTED.pageViews);
      expect(await overview.summary({ range: '24h', env: 'prod' })).toEqual(prod);
    });

    it('env=staging / dev narrow to that environment; env=all adds everything up', async () => {
      const staging = await overview.summary({ range: '24h', env: 'staging' });
      expect(staging.requests.value).toBe(EXPECTED.stagingRequests);
      expect(staging.pageViews.value).toBe(0);
      const dev = await overview.summary({ range: '24h', env: 'dev' });
      expect(dev).toMatchObject({ requests: { value: 0 }, pageViews: { value: 1 } });
      const all = await overview.summary({ range: '24h', env: 'all' });
      expect(all.requests.value).toBe(EXPECTED.requests + EXPECTED.stagingRequests);
      expect(all.pageViews.value).toBe(EXPECTED.pageViews + EXPECTED.devPageViews);
      // the per-route tables follow the same filter
      const routes = await endpoints.list({
        range: '24h',
        env: 'all',
        sort: 'calls',
        dir: 'desc',
        limit: 50,
      });
      const store = routes.items.find((item) => item.endpointId === ENDPOINT_IDS.storeLookup);
      expect(store?.calls).toBe(EXPECTED.calls.storeLookup + EXPECTED.stagingRequests);
    });
  });

  describe('OverviewService.apps linking KPI (ADR 0013)', () => {
    it('linkedPct = linked / LINKABLE calls (the stream and header-less calls are handled apart)', async () => {
      const dto = await overview.apps({ range: '24h' });
      const bySlug = new Map(dto.items.map((item) => [item.app, item]));
      expect(bySlug.get(SALES_SLUG)?.linkedPct).toBeCloseTo(
        (EXPECTED.salesLinked / EXPECTED.salesLinkable) * 100,
        2,
      );
      expect(bySlug.get(HR_SLUG)?.linkedPct).toBe(100);
    });
  });

  describe('OverviewService.breakdown', () => {
    const breakdown = (query: Record<string, unknown>) =>
      overview.breakdown(breakdownOverviewQuerySchema.parse(query));

    it('browser: page views per value, NULL last, shares of the whole window', async () => {
      const tz = await breakdown({ dimension: 'client_tz' });
      expect(tz).toMatchObject({ source: 'browser', dimension: 'client_tz', total: 3 });
      expect(tz.items).toEqual([
        { value: 'Asia/Kolkata', events: 2, share: 0.6667 },
        { value: null, events: 1, share: 0.3333 },
      ]);
      const release = await breakdown({ dimension: 'release' });
      expect(release.items).toEqual([
        { value: RELEASE_R1, events: 2, share: 0.6667 },
        { value: null, events: 1, share: 0.3333 },
      ]);
      const browsers = await breakdown({ dimension: 'browser', app: SALES_SLUG });
      expect(browsers).toMatchObject({
        total: 2,
        items: [{ value: 'Chrome', events: 2, share: 1 }],
      });
    });

    it('honours env (the dev page view appears only with env=dev / all) and limit', async () => {
      const all = await breakdown({ dimension: 'client_tz', env: 'all' });
      expect(all.total).toBe(4);
      expect(all.items.map((item) => [item.value, item.events])).toEqual([
        ['Asia/Kolkata', 2],
        ['Europe/London', 1],
        [null, 1],
      ]);
      const top1 = await breakdown({ dimension: 'client_tz', env: 'all', limit: 1 });
      expect(top1).toMatchObject({ total: 4, items: [{ value: 'Asia/Kolkata', share: 0.5 }] });
      const dev = await breakdown({ dimension: 'client_lang', env: 'dev' });
      expect(dev.items).toEqual([{ value: 'en-GB', events: 1, share: 1 }]);
    });

    it('server: every API call of the window by an api_requests column', async () => {
      const release = await breakdown({ source: 'server', dimension: 'release' });
      expect(release).toMatchObject({ source: 'server', total: EXPECTED.requests });
      expect(release.items).toEqual([{ value: API_RELEASE, events: EXPECTED.requests, share: 1 }]);
      const environments = await breakdown({
        source: 'server',
        dimension: 'environment',
        env: 'all',
      });
      expect(environments.items).toEqual([
        { value: 'prod', events: EXPECTED.requests, share: 0.875 },
        { value: 'staging', events: EXPECTED.stagingRequests, share: 0.125 },
      ]);
    });

    it('time_reason is read from page_time rows (none in this dataset → empty)', async () => {
      expect(await breakdown({ dimension: 'time_reason' })).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('OverviewService.devices', () => {
    it('new vs returning devices with the bounded lookback', async () => {
      const dto = await overview.devices({ range: '24h' });
      expect(dto).toMatchObject({
        devices: EXPECTED.devices.devices,
        returningDevices: EXPECTED.devices.returning,
        newDevices: EXPECTED.devices.new,
      });
      expect(new Date(dto.lookbackFrom).getTime()).toBe(
        new Date(dto.window.from).getTime() - 30 * 24 * HOUR,
      );
    });

    it('scopes BOTH windows by app and environment', async () => {
      expect(await overview.devices({ range: '24h', app: SALES_SLUG })).toMatchObject({
        devices: 2,
        returningDevices: 1,
        newDevices: 1,
      });
      // the dev view's device was seen before only in PROD → new in dev
      expect(await overview.devices({ range: '24h', env: 'dev' })).toMatchObject({
        devices: 1,
        returningDevices: 0,
        newDevices: 1,
      });
      expect(await overview.devices({ range: '24h', env: 'all' })).toMatchObject({
        devices: 3,
        returningDevices: 1,
      });
    });
  });

  // ─── API Routes ───────────────────────────────────────────────────────────

  describe('EndpointService.list', () => {
    const ids = (items: EndpointStatsDto[]) => items.map((i) => i.endpointId);

    it('aggregates per endpoint with percentiles over http rows only', async () => {
      const page = await endpoints.list({ range: '24h', sort: 'calls', dir: 'desc', limit: 50 });
      expect(ids(page.items)).toEqual([
        ENDPOINT_IDS.storeLookup,
        ENDPOINT_IDS.leaveList,
        ENDPOINT_IDS.reportExport,
      ]);
      const report = page.items.find((i) => i.endpointId === ENDPOINT_IDS.reportExport);
      expect(report).toMatchObject({
        app: SALES_SLUG,
        method: 'POST',
        routeTemplate: '/ebo-sales/api/reports/export',
        calls: EXPECTED.calls.reportExport,
        errors4xx: 1,
        errors5xx: 2,
        errorRate: 60,
      });
      expectMs(report?.p50Ms ?? null, percentileCont(HTTP_DURATIONS.reportExport, 0.5));
      expectMs(report?.p95Ms ?? null, percentileCont(HTTP_DURATIONS.reportExport, 0.95));
      expectMs(report?.p99Ms ?? null, percentileCont(HTTP_DURATIONS.reportExport, 0.99));
      expectMs(report?.avgMs ?? null, 2500);
      expect(page.nextCursor).toBeNull();
    });

    it('orders by each whitelisted key', async () => {
      const byErrorRate = await endpoints.list({
        range: '24h',
        sort: 'errorRate',
        dir: 'desc',
        limit: 50,
      });
      expect(ids(byErrorRate.items)).toEqual([
        ENDPOINT_IDS.reportExport,
        ENDPOINT_IDS.leaveList,
        ENDPOINT_IDS.storeLookup,
      ]);
      const byP95 = await endpoints.list({ range: '24h', sort: 'p95', dir: 'asc', limit: 50 });
      expect(ids(byP95.items)).toEqual([
        ENDPOINT_IDS.leaveList,
        ENDPOINT_IDS.storeLookup,
        ENDPOINT_IDS.reportExport,
      ]);
    });

    it('pages with the offset cursor without duplicates or gaps', async () => {
      const first = await endpoints.list({ range: '24h', sort: 'calls', dir: 'desc', limit: 2 });
      expect(ids(first.items)).toEqual([ENDPOINT_IDS.storeLookup, ENDPOINT_IDS.leaveList]);
      expect(first.nextCursor).not.toBeNull();
      const second = await endpoints.list({
        range: '24h',
        sort: 'calls',
        dir: 'desc',
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      expect(ids(second.items)).toEqual([ENDPOINT_IDS.reportExport]);
      expect(second.nextCursor).toBeNull();
    });

    it('filters by app and by a route-template search', async () => {
      const hr = await endpoints.list({
        range: '24h',
        app: HR_SLUG,
        sort: 'calls',
        dir: 'desc',
        limit: 50,
      });
      expect(ids(hr.items)).toEqual([ENDPOINT_IDS.leaveList]);
      const search = await endpoints.list({
        range: '24h',
        search: 'REPORTS',
        sort: 'calls',
        dir: 'desc',
        limit: 50,
      });
      expect(ids(search.items)).toEqual([ENDPOINT_IDS.reportExport]);
    });
  });

  describe('EndpointService.detail', () => {
    it("counts the route's unique users and ranks its top callers by calls", async () => {
      const dto = await endpoints.detail(ENDPOINT_IDS.reportExport, { range: '24h' }, ADMIN);
      expect(dto.uniqueUsers).toBe(dto.topUsers.length);
      const calls = dto.topUsers.map((user) => user.count);
      expect([...calls].sort((a, b) => b - a)).toEqual(calls);
      expect(calls.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(dto.endpoint.calls);
    });

    it('returns stats, the series, the status breakdown and the slowest http calls', async () => {
      const dto = await endpoints.detail(ENDPOINT_IDS.reportExport, { range: '24h' }, ADMIN);
      expect(dto.endpoint.calls).toBe(EXPECTED.calls.reportExport);
      expect(dto.timeseries).toHaveLength(24);
      expect(dto.timeseries.reduce((sum, p) => sum + p.requests, 0)).toBe(
        EXPECTED.calls.reportExport,
      );
      expect(dto.statusBreakdown).toEqual([
        { status: 200, count: 2 },
        { status: 500, count: 2 },
        { status: 404, count: 1 },
      ]);
      // Streams are not "slow calls"; slowest first.
      expect(dto.slowest.map((s) => s.durationMs)).toEqual([4000, 3000, 2000, 1000]);
      expect(dto.slowest[0]?.actor.ip).toBe(SEEDED_IP);
      expect(dto.slowest[0]?.actor.userKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('masks IPs for non-admins', async () => {
      const dto = await endpoints.detail(ENDPOINT_IDS.reportExport, { range: '24h' }, VIEWER);
      expect(dto.slowest.every((s) => s.actor.ip === null)).toBe(true);
      expect(JSON.stringify(dto)).not.toContain(SEEDED_IP);
    });

    it('404 for an endpoint with no rows in the window, or outside the app filter', async () => {
      await expect(
        endpoints.detail('00000000-0000-5000-8000-000000000000', { range: '24h' }, ADMIN),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        endpoints.detail(ENDPOINT_IDS.reportExport, { range: '24h', app: HR_SLUG }, ADMIN),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ─── Errors ───────────────────────────────────────────────────────────────

  describe('ErrorService.summary', () => {
    it('totals failures by class and status, and lists the failing endpoints only', async () => {
      const dto = await errors.summary({ range: '24h' }, VIEWER);
      expect(dto).toMatchObject({
        total: EXPECTED.failures,
        errors4xx: EXPECTED.errors4xx,
        errors5xx: EXPECTED.errors5xx,
      });
      expect(dto.byStatus).toEqual([
        { status: 401, count: 2 },
        { status: 500, count: 2 },
        { status: 404, count: 1 },
        { status: 503, count: 1 },
      ]);
      expect(dto.timeseries).toHaveLength(24);
      expect(new Set(dto.topEndpoints.map((e) => e.endpointId))).toEqual(
        new Set([ENDPOINT_IDS.reportExport, ENDPOINT_IDS.leaveList]),
      );
    });

    it('counts the users hit by failures, and scopes to one user', async () => {
      const all = await errors.summary({ range: '24h' }, VIEWER);
      expect(all.usersAffected).toBe(all.topAffectedUsers.length);
      const top = all.topAffectedUsers[0];
      if (top) {
        const one = await errors.summary({ range: '24h', userKey: top.userKey }, ADMIN);
        expect(one.total).toBe(top.count);
        expect(one.usersAffected).toBe(1);
      }
    });

    it('scopes every number to one route when endpointId is given', async () => {
      const all = await errors.summary({ range: '24h' }, VIEWER);
      const route = all.topEndpoints.find((e) => e.endpointId === ENDPOINT_IDS.leaveList)!;
      const dto = await errors.summary(
        { range: '24h', endpointId: ENDPOINT_IDS.leaveList },
        VIEWER,
      );
      expect(dto.total).toBe(route.errors4xx + route.errors5xx);
      expect(dto.topEndpoints.map((e) => e.endpointId)).toEqual([ENDPOINT_IDS.leaveList]);
    });
  });

  describe('ErrorService by error code', () => {
    // The seed sends no codes; tag the six current-window failures for this block only:
    // 500 ×2 (reportExport) + 503 (leaveList) → UPSTREAM_TIMEOUT, 401 ×2 (leaveList) →
    // AUTH_EXPIRED, 404 (reportExport) stays NULL ("no code sent").
    beforeAll(async () => {
      await db.ownerPool.query(
        `UPDATE traffic.api_requests
            SET error_code = CASE WHEN status_code IN (500, 503) THEN 'UPSTREAM_TIMEOUT'
                                  WHEN status_code = 401 THEN 'AUTH_EXPIRED' END
          WHERE event_id = ANY($1::uuid[])`,
        [seed.failureIds],
      );
    });

    afterAll(async () => {
      await db.ownerPool.query(
        `UPDATE traffic.api_requests SET error_code = NULL WHERE event_id = ANY($1::uuid[])`,
        [seed.failureIds],
      );
    });

    it('groups the failures by code (most first, NULL last on ties) with distinct routes', async () => {
      const dto = await errors.summary({ range: '24h' }, VIEWER);
      expect(dto.byErrorCode).toEqual([
        { errorCode: 'UPSTREAM_TIMEOUT', count: 3, routes: 2 },
        { errorCode: 'AUTH_EXPIRED', count: 2, routes: 1 },
        { errorCode: null, count: 1, routes: 1 },
      ]);
    });

    it('scopes the summary and the list to one code', async () => {
      const dto = await errors.summary({ range: '24h', errorCode: 'UPSTREAM_TIMEOUT' }, VIEWER);
      expect(dto).toMatchObject({ total: 3, errors4xx: 0, errors5xx: 3 });
      expect(dto.byErrorCode).toEqual([{ errorCode: 'UPSTREAM_TIMEOUT', count: 3, routes: 2 }]);

      const page = await errors.list(
        { range: '24h', statusClass: 'all', limit: 50, errorCode: 'AUTH_EXPIRED' },
        ADMIN,
      );
      expect(page.items.map((f) => [f.status, f.errorCode])).toEqual([
        [401, 'AUTH_EXPIRED'],
        [401, 'AUTH_EXPIRED'],
      ]);
      const none = await errors.list(
        { range: '24h', statusClass: '5xx', limit: 50, errorCode: 'AUTH_EXPIRED' },
        ADMIN,
      );
      expect(none.items).toEqual([]);
    });

    it("keeps each top failing route's calls over ALL its requests: errorRate = coded failures / calls", async () => {
      const dto = await errors.summary({ range: '24h', errorCode: 'UPSTREAM_TIMEOUT' }, VIEWER);
      const byId = new Map(dto.topEndpoints.map((e) => [e.endpointId, e]));
      expect(new Set(byId.keys())).toEqual(
        new Set([ENDPOINT_IDS.reportExport, ENDPOINT_IDS.leaveList]),
      );
      const report = byId.get(ENDPOINT_IDS.reportExport)!;
      expect(report).toMatchObject({
        calls: EXPECTED.calls.reportExport,
        errors4xx: 0,
        errors5xx: 2,
      });
      expect(report.errorRate).toBeCloseTo((2 / EXPECTED.calls.reportExport) * 100, 2);
      const leave = byId.get(ENDPOINT_IDS.leaveList)!;
      expect(leave).toMatchObject({ calls: EXPECTED.calls.leaveList, errors4xx: 0, errors5xx: 1 });
      expect(leave.errorRate).toBeCloseTo((1 / EXPECTED.calls.leaveList) * 100, 2);

      // onlyFailing honours the code: reportExport has no AUTH_EXPIRED failure → not listed.
      const auth = await errors.summary({ range: '24h', errorCode: 'AUTH_EXPIRED' }, VIEWER);
      expect(auth.topEndpoints.map((e) => [e.endpointId, e.calls, e.errors4xx])).toEqual([
        [ENDPOINT_IDS.leaveList, EXPECTED.calls.leaveList, 2],
      ]);
      // The series still counts every request; only its failure columns follow the code.
      expect(auth.timeseries.reduce((sum, p) => sum + p.requests, 0)).toBe(EXPECTED.requests);
      expect(auth.timeseries.reduce((sum, p) => sum + p.errors4xx + p.errors5xx, 0)).toBe(2);
    });
  });

  describe('ErrorService.list', () => {
    /** Follows nextCursor until the end; returns every page. */
    async function allPages(
      query: Parameters<ErrorService['list']>[0],
    ): Promise<FailedRequestDto[][]> {
      const pages: FailedRequestDto[][] = [];
      let cursor: string | undefined;
      do {
        const page = await errors.list({ ...query, cursor }, ADMIN);
        pages.push(page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && pages.length < 20);
      return pages;
    }

    it('keyset-pages the failures newest first, without duplicates or gaps', async () => {
      const pages = await allPages({ range: '24h', statusClass: 'all', limit: 2 });
      expect(pages.map((p) => p.length)).toEqual([2, 2, 2]);
      expect(pages.flat().map((f) => f.eventId)).toEqual(seed.failureIds);
    });

    it('keeps microsecond order at page boundaries (same millisecond, distinct µs, tied instants)', async () => {
      const at = microsecondBlockAt(seed.now);
      const pages = await allPages({
        range: 'custom',
        from: new Date(at.getTime() - 60_000).toISOString(),
        to: new Date(at.getTime() + 60_000).toISOString(),
        statusClass: '5xx',
        limit: 2,
      });
      expect(pages.flat().map((f) => f.eventId)).toEqual(seed.microsecondIds);
    });

    it('filters by status class, endpoint and app', async () => {
      const only = async (query: Partial<Parameters<ErrorService['list']>[0]>) =>
        (await errors.list({ range: '24h', statusClass: 'all', limit: 50, ...query }, ADMIN)).items;
      expect((await only({ statusClass: '5xx' })).map((f) => f.status).sort()).toEqual([
        500, 500, 503,
      ]);
      expect((await only({ statusClass: '4xx' })).map((f) => f.status).sort()).toEqual([
        401, 401, 404,
      ]);
      expect((await only({ endpointId: ENDPOINT_IDS.leaveList })).length).toBe(3);
      expect((await only({ app: SALES_SLUG })).every((f) => f.app === SALES_SLUG)).toBe(true);
    });

    it('masks IPs for non-admins', async () => {
      const page = await errors.list({ range: '24h', statusClass: 'all', limit: 50 }, VIEWER);
      expect(page.items.length).toBe(EXPECTED.failures);
      expect(JSON.stringify(page)).not.toContain(SEEDED_IP);
    });
  });

  it('the query pool is read-only (a dashboard bug can never write)', async () => {
    await expect(queryPool.query('DELETE FROM traffic.api_requests')).rejects.toMatchObject({
      code: '25006',
    });
  });
});

describe.skipIf(!RUN_DB_TESTS)('S3 browser analytics as nexus_app on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let seed: JourneySeed;
  let users: UserService;
  let webEvents: WebEventQueryRepository;
  let requests: ApiRequestQueryRepository;
  let appSlugs: AppSlugResolver;
  let clock: FixedClock;
  let journeys: JourneyService;
  let pages: PageService;
  let tools: ToolService;
  let geo: GeoService;

  beforeAll(async () => {
    db = await createTestDatabase('journeys');
    seed = await seedJourneys(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    webEvents = new WebEventQueryRepository(queryPool);
    appSlugs = new AppSlugResolver(new AppRepository(queryPool));
    clock = new FixedClock(seed.now);
    requests = new ApiRequestQueryRepository(queryPool);
    // The access log is written on the WRITE pool (appPool), like in the container.
    const recorder = new PersonAccessRecorder(
      new PersonAccessLogRepository(db.appPool),
      webEvents,
      clock,
      quietLogger,
    );
    users = new UserService(webEvents, requests, appSlugs, clock, recorder);
    journeys = new JourneyService(webEvents, appSlugs, clock, recorder);
    pages = new PageService(webEvents, requests, appSlugs, clock);
    tools = new ToolService(webEvents, appSlugs, clock);
    geo = new GeoService(webEvents, appSlugs, clock);
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  // ─── Users ────────────────────────────────────────────────────────────────

  /** The list defaults the API's schema applies (range 24h, most recently seen first). */
  const LIST = { range: '24h', sort: 'lastSeen', dir: 'desc' } as const;

  describe('UserService', () => {
    it('lists ONLY verified users over both tables, most recently seen first', async () => {
      const page = await users.list({ ...LIST, limit: 50 });
      expect(page.items).toMatchObject(JOURNEY_EXPECTED.users);
      expect(page.items.map((u) => u.userKey)).toEqual([userKeyHex(USER_B), userKeyHex(USER_A)]);
      expect(JSON.stringify(page)).not.toContain(CLAIMED_EMAIL);
    });

    it('searches by email and offset-pages', async () => {
      const found = await users.search({ ...LIST, limit: 50, search: 'A@LIBAS' });
      expect(found.items.map((u) => u.email)).toEqual([USER_A]);
      const first = await users.list({ ...LIST, limit: 1 });
      const second = await users.list({ ...LIST, limit: 1, cursor: first.nextCursor ?? '' });
      expect([...first.items, ...second.items].map((u) => u.email)).toEqual([USER_B, USER_A]);
      expect(second.nextCursor).toBeNull();
    });

    it('profile: header numbers, top tools/pages and countries; unknown user → 404', async () => {
      const dto = await users.profile(userKeyHex(USER_A), { range: '24h' }, ADMIN);
      expect(dto).toMatchObject({
        summary: { email: USER_A, requests: 1, pageViews: 3 },
        firstSeenAt: new Date(seed.now.getTime() - 60 * 60_000).toISOString(),
        failedRequests: 0,
        topTools: [{ app: SALES_SLUG, tool: 'export-csv', uses: 1 }],
        topPages: [
          { app: SALES_SLUG, pathTemplate: '/home', views: 1 },
          { app: SALES_SLUG, pathTemplate: '/reports', views: 1 },
          { app: SALES_SLUG, pathTemplate: '/stores/:id', views: 1 },
        ],
        countries: [MUMBAI.country],
      });
      await expect(users.profile('0'.repeat(64), { range: '24h' }, ADMIN)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('timeline: pages + tools + API calls newest first, keyset-paged, page_time folded in', async () => {
      const items: TimelineItemDto[] = [];
      let cursor: string | undefined;
      let pagesRead = 0;
      do {
        const page = await users.timeline(
          userKeyHex(USER_A),
          { range: '24h', limit: 2, cursor },
          ADMIN,
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pagesRead += 1;
      } while (cursor && pagesRead < 10);
      expect(pagesRead).toBe(3);
      expect(items.map((i) => i.eventId)).toEqual(seed.userATimelineIds);
      expect(items.map((i) => i.kind)).toEqual([
        'page_view',
        'tool_use',
        'api',
        'page_view',
        'page_view',
      ]);
      expect(items.map((i) => i.visibleMs)).toEqual([null, null, null, 6000, 4000]);
      expect(items[2]).toMatchObject({ method: 'GET', status: 200 });
      expect(items[0]?.ip).toBe(SEEDED_IP);
    });

    it('devices: one row per (device, browser, OS) over both tables, newest first; latest browser facts', async () => {
      const ago = (minutes: number) =>
        new Date(seed.now.getTime() - minutes * 60_000).toISOString();
      const dto = await users.devices(userKeyHex(USER_A), { range: '24h' }, ADMIN);
      // J1's browser events carry no User-Agent fields; its API call is Chrome 120 / Windows 10.
      expect(dto.items).toEqual([
        {
          device: null,
          browser: null,
          os: null,
          firstSeenAt: ago(60),
          lastSeenAt: ago(54),
          pageViews: 3,
          requests: 0,
          visits: 1,
          apps: [SALES_SLUG],
        },
        {
          device: 'desktop',
          browser: 'Chrome 120',
          os: 'Windows 10',
          firstSeenAt: ago(57.5),
          lastSeenAt: ago(57.5),
          pageViews: 0,
          requests: 1,
          visits: 0,
          apps: [SALES_SLUG],
        },
      ]);
      expect(dto).not.toHaveProperty('latest');
      // The latest browser facts come with the profile (the identity card), not with devices.
      const profile = await users.profile(userKeyHex(USER_A), { range: '24h' }, ADMIN);
      expect(profile.latest).toEqual({
        seenAt: ago(54),
        app: SALES_SLUG,
        device: null,
        browser: null,
        os: null,
        timeZone: null,
        language: null,
        appVersion: null,
      });
      expect(await users.devices('0'.repeat(64), { range: '24h' }, ADMIN)).toMatchObject({
        items: [],
      });
    });

    it('daily: one IST day with first/last activity over both tables and the tab-visible time', async () => {
      const ago = (minutes: number) =>
        new Date(seed.now.getTime() - minutes * 60_000).toISOString();
      const dto = await users.daily(userKeyHex(USER_A), { range: '24h' }, ADMIN);
      // seed.now is 12:00 IST, so that IST day began 12 hours earlier.
      expect(dto.items).toEqual([
        {
          day: ago(12 * 60),
          firstActivityAt: ago(60),
          lastActivityAt: ago(54),
          activeMs: 4000 + 3000 + 3000,
          pageViews: 3,
          requests: 1,
          failedRequests: 0,
          toolUses: 1,
          visits: 1,
          apps: [SALES_SLUG],
          inProgress: true,
          perApp: [
            {
              app: SALES_SLUG,
              firstActivityAt: ago(60),
              lastActivityAt: ago(54),
              activeMs: 4000 + 3000 + 3000,
              pageViews: 3,
              requests: 1,
              failedRequests: 0,
              toolUses: 1,
              visits: 1,
            },
          ],
        },
      ]);
      // 24h ending 12:00 IST is widened to whole IST days: yesterday 00:00 up to tomorrow 00:00.
      expect(dto.window).toMatchObject({ from: ago(36 * 60), to: ago(-12 * 60) });
      expect((await users.daily('0'.repeat(64), { range: '24h' }, ADMIN)).items).toEqual([]);
    });

    it('timeline: non-admins never receive an IP', async () => {
      const page = await users.timeline(userKeyHex(USER_A), { range: '24h', limit: 50 }, VIEWER);
      expect(page.items).toHaveLength(5);
      expect(JSON.stringify(page)).not.toContain(SEEDED_IP);
    });
  });

  // ─── Person access log (0013): written on the write pool, append-only ─────

  describe('PersonAccessRecorder + PrivacyService.accessLog', () => {
    const AUDITOR: Viewer = { email: 'auditor@libas.in', isAdmin: true };

    it('one row per viewer + person + surface (coalesced), masked email, newest first', async () => {
      const log = new PersonAccessLogRepository(db.appPool);
      const audited = new UserService(
        webEvents,
        requests,
        appSlugs,
        clock,
        new PersonAccessRecorder(log, webEvents, clock, quietLogger),
      );
      await audited.profile(userKeyHex(USER_A), { range: '24h' }, AUDITOR);
      await audited.profile(userKeyHex(USER_A), { range: '24h' }, AUDITOR);
      await audited.daily(userKeyHex(USER_A), { range: '24h' }, AUDITOR);
      // Nobody in the window → nothing about them was shown → no row.
      await audited.devices('0'.repeat(64), { range: '24h' }, AUDITOR);

      const { rows } = await db.ownerPool.query<{ surface: string; subject_email_masked: string }>(
        `SELECT surface, subject_email_masked FROM traffic.person_access_log
          WHERE viewer_email = $1 ORDER BY id`,
        [AUDITOR.email],
      );
      expect(rows).toEqual([
        { surface: 'person_profile', subject_email_masked: 'a***@libas.in' },
        { surface: 'person_daily', subject_email_masked: 'a***@libas.in' },
      ]);

      const privacy = new PrivacyService(log);
      const first = await privacy.accessLog({ limit: 1, userKey: userKeyHex(USER_A) });
      expect(first.items[0]).toMatchObject({ subjectUserKey: userKeyHex(USER_A) });
      expect(first.nextCursor).not.toBeNull();
      const all = await privacy.accessLog({ limit: 200, userKey: userKeyHex(USER_A) });
      const auditorRows = all.items.filter((item) => item.viewerEmail === AUDITOR.email);
      expect(auditorRows.map((item) => item.surface)).toEqual(['person_daily', 'person_profile']);
      expect(JSON.stringify(all)).not.toContain(USER_A);
      const second = await privacy.accessLog({
        limit: 200,
        userKey: userKeyHex(USER_A),
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items.map((item) => item.id)).toEqual(
        all.items.slice(1).map((item) => item.id),
      );
    });

    it('is append-only for every role: UPDATE, DELETE and TRUNCATE are refused', async () => {
      for (const pool of [db.appPool, db.ownerPool]) {
        for (const sql of [
          `UPDATE traffic.person_access_log SET viewer_email = 'x@libas.in'`,
          'DELETE FROM traffic.person_access_log',
          'TRUNCATE traffic.person_access_log',
        ]) {
          await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
        }
      }
    });

    it('refuses a full email in the masked column', async () => {
      await expect(
        db.appPool.query(
          `INSERT INTO traffic.person_access_log
             (viewer_email, subject_user_key, subject_email_masked, surface)
           VALUES ($1, $2, $3, 'person_profile')`,
          ['boss@libas.in', Buffer.alloc(32, 1), USER_A],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ─── Journeys ─────────────────────────────────────────────────────────────

  describe('JourneyService', () => {
    it('sessions: most recent first, strongest identity, entry/exit, visible time', async () => {
      const page = await journeys.sessions({ range: '24h', limit: 50 }, ADMIN);
      expect(page.items.map((s) => s.sessionId)).toEqual([
        seed.sessions.j3,
        seed.sessions.j2,
        seed.sessions.j1,
      ]);
      const [j3, j2, j1] = page.items;
      expect(j1).toMatchObject({
        app: SALES_SLUG,
        durationMs: 6 * 60_000,
        pageViews: 3,
        toolUses: 1,
        visibleMs: 10_000,
        userKey: userKeyHex(USER_A),
        userEmail: USER_A,
        identitySource: 'sso_cookie',
        entryPath: '/home',
        exitPath: '/reports',
        country: 'IN',
        ip: SEEDED_IP,
      });
      expect(j2).toMatchObject({
        userKey: null,
        userEmail: null,
        claimedEmail: CLAIMED_EMAIL,
        identitySource: 'client_claimed',
        visibleMs: 1000,
      });
      expect(j3).toMatchObject({ app: HR_SLUG, ip: null, country: null, exitPath: '/leaves' });
    });

    it('sessions: scoped to one user; IP masked for non-admins', async () => {
      const mine = await journeys.sessions(
        { range: '24h', limit: 50, userKey: userKeyHex(USER_A) },
        VIEWER,
      );
      expect(mine.items.map((s) => s.sessionId)).toEqual([seed.sessions.j1]);
      expect(JSON.stringify(mine)).not.toContain(SEEDED_IP);
    });

    it('session: replay in seq order with the correlated API call interleaved by time', async () => {
      const dto = await journeys.session(SALES_SLUG, seed.sessions.j1, { range: '24h' }, ADMIN);
      expect(dto.summary.sessionId).toBe(seed.sessions.j1);
      expect(dto.events.map((e) => e.eventId)).toEqual(seed.j1ReplayIds);
      expect(dto.events.map((e) => e.kind)).toEqual([
        'page_view',
        'page_view',
        'api',
        'tool_use',
        'page_view',
      ]);
      expect(dto.events.map((e) => e.visibleMs)).toEqual([4000, 6000, null, null, null]);
    });

    it('session: wrong app, unknown session or outside the window → 404', async () => {
      const missing = (app: string, sessionId: string, range: '24h' | '15m' = '24h') =>
        journeys.session(app, sessionId, { range }, ADMIN);
      await expect(missing(HR_SLUG, seed.sessions.j1)).rejects.toMatchObject({ statusCode: 404 });
      await expect(missing(SALES_SLUG, seed.sessions.j3)).rejects.toMatchObject({
        statusCode: 404,
      });
      // J1 ended 54 minutes before now: nothing of it falls in the last 15 minutes.
      await expect(missing(SALES_SLUG, seed.sessions.j1, '15m')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('topPaths: reloads collapse, so both sales sessions share one 3-step path', async () => {
      const dto = await journeys.topPaths({ range: '24h', limit: 20 });
      expect(dto.items).toEqual(JOURNEY_EXPECTED.topPaths);
    });
  });

  // ─── Pages & Tools ────────────────────────────────────────────────────────

  it('PageService.list: views, sessions, avg/p50 visible time and exits per template', async () => {
    const dto = await pages.list({ range: '24h', limit: 50 });
    expect(dto.items.map(({ pageId: _id, distinctUsers: _users, ...rest }) => rest)).toEqual(
      JOURNEY_EXPECTED.pages,
    );
    for (const page of dto.items) {
      expect(page.pageId).toBe(toPageId(page.app, page.pathTemplate));
      expect(page.distinctUsers).toBeLessThanOrEqual(page.uniqueSessions);
    }
    const hrOnly = await pages.list({ range: '24h', limit: 50, app: HR_SLUG });
    expect(hrOnly.items.map((p) => p.pathTemplate)).toEqual(['/leaves']);
  });

  it('ToolService.usage: uses, verified users, sessions and a 24-point trend', async () => {
    const dto = await tools.usage({ range: '24h', limit: 50 });
    expect(dto.items).toMatchObject([
      { app: SALES_SLUG, tool: 'export-csv', uses: 2, distinctUsers: 1, distinctSessions: 2 },
      { app: HR_SLUG, tool: 'apply-leave', uses: 1, distinctUsers: 1, distinctSessions: 1 },
    ]);
    const trend = dto.items[0]?.trend ?? [];
    expect(trend).toHaveLength(24);
    expect(trend.reduce((sum, p) => sum + p.uses, 0)).toBe(2);
  });

  // ─── Wave 2 drill-downs ───────────────────────────────────────────────────

  describe('drill-downs (pages, tools, users)', () => {
    it('PageService.detail agrees with the list and its trend adds up to the views', async () => {
      const list = await pages.list({ range: '24h', limit: 50 });
      const home = list.items.find((p) => p.pathTemplate === '/home')!;
      const dto = await pages.detail(home.app, home.pageId, { range: '24h' });
      expect(dto.page).toEqual(home);
      expect(dto.trend.reduce((sum, p) => sum + p.views, 0)).toBe(home.views);
      expect(dto.topUsers.reduce((sum, u) => sum + u.count, 0)).toBeLessThanOrEqual(home.views);
      for (const link of [...dto.cameFrom, ...dto.wentTo]) {
        expect(link.pageId).toBe(toPageId(home.app, link.pathTemplate));
        expect(link.pathTemplate).not.toBe('/home');
      }
      await expect(
        pages.detail(home.app, toPageId(home.app, '/never-seen'), { range: '24h' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('ToolService.detail: users, pages and actions add up to the uses', async () => {
      const dto = await tools.detail(SALES_SLUG, toToolId(SALES_SLUG, 'export-csv'), {
        range: '24h',
      });
      expect(dto.tool).toMatchObject({ tool: 'export-csv', uses: 2, distinctUsers: 1 });
      expect(dto.pages.reduce((sum, p) => sum + p.uses, 0)).toBe(2);
      expect(dto.actions.reduce((sum, a) => sum + a.uses, 0)).toBe(2);
      expect(dto.topUsers.reduce((sum, u) => sum + u.count, 0)).toBeLessThanOrEqual(2);
    });

    it('UserService.list sorts by a whitelisted key in both directions', async () => {
      const desc = await users.list({ ...LIST, sort: 'pageViews', limit: 50 });
      expect(desc.items.map((u) => u.email)).toEqual([USER_A, USER_B]);
      const asc = await users.list({ ...LIST, sort: 'pageViews', dir: 'asc', limit: 50 });
      expect(asc.items.map((u) => u.email)).toEqual([USER_B, USER_A]);
    });

    it('UserService.profile: per-app activity and top routes', async () => {
      const dto = await users.profile(userKeyHex(USER_A), { range: '24h' }, ADMIN);
      expect(dto.perApp).toMatchObject([{ app: SALES_SLUG, requests: 1, pageViews: 3 }]);
      expect(dto.topEndpoints.reduce((sum, e) => sum + e.calls, 0)).toBe(1);
    });

    it('UserService.activity: daily users never exceed WAU, WAU never exceeds MAU', async () => {
      const dto = await users.activity({ range: '24h' });
      expect(dto.points.length).toBeGreaterThan(0);
      expect(Math.max(...dto.points.map((p) => p.users))).toBeLessThanOrEqual(dto.wau);
      expect(dto.wau).toBeGreaterThanOrEqual(2);
      expect(dto.mau).toBeGreaterThanOrEqual(dto.wau);
    });
  });

  // ─── Geography ────────────────────────────────────────────────────────────

  it('GeoService: countries and cities over API calls + page views, busiest first', async () => {
    const countries = await geo.countries({ range: '24h', limit: 100 });
    expect(countries.items).toEqual(JOURNEY_EXPECTED.countries);

    const cities = await geo.cities({ range: '24h', limit: 100 });
    expect(cities.items.map((c) => c.city)).toEqual([BENGALURU.city, MUMBAI.city, null]);
    expect(cities.items[1]).toMatchObject({
      region: MUMBAI.region,
      lat: MUMBAI.lat,
      lon: MUMBAI.lon,
      requests: 0,
      pageViews: 3,
      users: 1,
    });
    expect(cities.items[2]).toMatchObject({ requests: 1, pageViews: 1, users: 2 });
  });

  // ─── Live backfill (S4 SQL: LiveService.snapshot → these two queries) ────────

  describe('WebEventQueryRepository live backfill', () => {
    const hourBefore = () => ({
      from: new Date(seed.now.getTime() - HOUR),
      to: seed.now,
      environments: PROD,
    });

    async function ownerCount(sql: string): Promise<number> {
      const { rows } = await db.ownerPool.query<{ n: string }>(sql, [
        hourBefore().from,
        hourBefore().to,
      ]);
      return Number(rows[0]?.n);
    }

    it('activityTimeseries: minute buckets whose totals equal the page views / tool uses of the window', async () => {
      const buckets = await new WebEventQueryRepository(queryPool).activityTimeseries(
        hourBefore(),
        'minute',
      );
      expect(buckets.length).toBeGreaterThan(0);
      for (const b of buckets) expect(new Date(b.bucket).getUTCSeconds()).toBe(0);
      const times = buckets.map((b) => new Date(b.bucket).getTime());
      expect(times).toEqual([...times].sort((x, y) => x - y));
      const window = `occurred_at >= $1 AND occurred_at < $2`;
      expect(buckets.reduce((sum, b) => sum + Number(b.page_views), 0)).toBe(
        await ownerCount(
          `SELECT count(*) AS n FROM traffic.web_events WHERE ${window} AND event_type = 'page_view'`,
        ),
      );
      expect(buckets.reduce((sum, b) => sum + Number(b.tool_uses), 0)).toBe(
        await ownerCount(
          `SELECT count(*) AS n FROM traffic.web_events WHERE ${window} AND event_type = 'tool_use'`,
        ),
      );
    });

    it('listRecentEvents: API calls + browser events (never page_time), newest first, limited', async () => {
      const repo = new WebEventQueryRepository(queryPool);
      const all = await repo.listRecentEvents(hourBefore(), 500);
      const window = `occurred_at >= $1 AND occurred_at < $2`;
      expect(all).toHaveLength(
        (await ownerCount(
          `SELECT count(*) AS n FROM traffic.web_events WHERE ${window} AND event_type <> 'page_time'`,
        )) + (await ownerCount(`SELECT count(*) AS n FROM traffic.api_requests WHERE ${window}`)),
      );
      expect(all.some((e) => e.kind === 'page_time')).toBe(false);
      expect(new Set(all.map((e) => e.kind)).has('api')).toBe(true);
      const times = all.map((e) => new Date(e.occurred_at).getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));

      const newest = await repo.listRecentEvents(hourBefore(), 3);
      expect(newest.map((e) => e.event_id)).toEqual(all.slice(0, 3).map((e) => e.event_id));
    });
  });

  // ─── Who is online (LiveService.online → listOnlineUsers + countOnlineByApp) ─

  describe('LiveService.online', () => {
    const minutesAgo = (minutes: number) => new Date(seed.now.getTime() - minutes * MINUTE);
    /** The service as if "now" were `minutes` before seed.now (the seed has nothing in the last 5 min). */
    const onlineAt = (minutes: number) =>
      new LiveService(
        new ApiRequestQueryRepository(queryPool),
        new WebEventQueryRepository(queryPool),
        new AppSlugResolver(new AppRepository(queryPool)),
        new FixedClock(minutesAgo(minutes)),
      );

    it('nobody is online when the last ACTIVE_USER_WINDOW_MS has no events', async () => {
      expect(await onlineAt(0).online({})).toEqual({
        asOf: seed.now.toISOString(),
        windowMs: ACTIVE_USER_WINDOW_MS,
        apps: [],
        users: [],
      });
    });

    it('API call as the newest event: route TEMPLATE label, page = newest page view, page_time not counted', async () => {
      // Window [−62.25, −57.25) min: J1 pv /home −60, page_time −59, pv /stores/42 −58, API call −57.5.
      const dto = await onlineAt(57.25).online({});
      expect(dto.apps).toEqual([{ app: SALES_SLUG, users: 1, anonymous: 0 }]);
      expect(dto.users).toEqual([
        {
          userKey: userKeyHex(USER_A),
          email: USER_A,
          app: SALES_SLUG,
          sessionId: seed.sessions.j1,
          currentPage: '/stores/:id',
          lastEvent: {
            kind: 'api',
            path: ROUTE.storeLookup.template,
            tool: null,
            method: 'GET',
            status: 200,
            endpointId: ENDPOINT_IDS.storeLookup,
          },
          lastSeenAt: minutesAgo(57.5).toISOString(),
          events: 3,
        },
      ]);
      const json = JSON.stringify(dto);
      expect(json).not.toContain('/stores/42'); // never a raw path
      expect(json).not.toContain(SEEDED_IP);
      expect(json).not.toMatch(/"ip"/);
    });

    it('browser event as the newest event; `to` is exclusive and `from` inclusive', async () => {
      // Window [−23, −18) min: J3 pv /leaves −20, tool apply-leave −19 (the custom event AT −18 is out).
      const before = await onlineAt(18).online({});
      expect(before.apps).toEqual([{ app: HR_SLUG, users: 1, anonymous: 0 }]);
      expect(before.users).toEqual([
        {
          userKey: userKeyHex(USER_B),
          email: USER_B,
          app: HR_SLUG,
          sessionId: seed.sessions.j3,
          currentPage: '/leaves',
          lastEvent: {
            kind: 'tool_use',
            path: '/leaves',
            tool: 'apply-leave',
            method: null,
            status: null,
            endpointId: null,
          },
          lastSeenAt: minutesAgo(19).toISOString(),
          events: 2,
        },
      ]);
      // Window [−20, −15) min: the page view AT −20 is in; the custom event is the newest.
      const after = await onlineAt(15).online({});
      expect(after.users).toHaveLength(1);
      expect(after.users[0]).toMatchObject({
        events: 3,
        currentPage: '/leaves',
        lastEvent: { kind: 'custom', path: '/leaves', tool: null },
        lastSeenAt: minutesAgo(18).toISOString(),
      });
    });

    it('page_time: a flush-only person is still listed (counted => listed), never the last event otherwise', async () => {
      const repo = new WebEventQueryRepository(queryPool);
      // [−56.5, −54.5) min: J1 has ONLY its two page_time deltas (−56, −55).
      const flushOnly = { from: minutesAgo(56.5), to: minutesAgo(54.5), environments: PROD };
      expect(await repo.countOnlineByApp(flushOnly)).toEqual([
        { app_slug: SALES_SLUG, users: 1, anonymous: 0 },
      ]);
      const rows = await repo.listOnlineUsers(flushOnly, 10);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        app_slug: SALES_SLUG,
        user_email: USER_A,
        kind: 'page_time',
        path: '/stores/:id',
        events: 0,
        last_seen_at: minutesAgo(55),
        current_page: null,
      });
      // Window [−59.5, −54.5): pv −58, API −57.5, tool −57, page_time −56/−55 → the tool is the
      // last ACTION, the newest flush is when they were last seen.
      const dto = await onlineAt(54.5).online({});
      expect(dto.apps).toEqual([{ app: SALES_SLUG, users: 1, anonymous: 0 }]);
      expect(dto.users).toHaveLength(1);
      expect(dto.users[0]).toMatchObject({
        currentPage: '/stores/:id',
        lastEvent: { kind: 'tool_use', tool: 'export-csv', path: '/stores/:id' },
        lastSeenAt: minutesAgo(55).toISOString(),
        events: 3,
      });
    });

    it('claims are NOT users: a client_claimed session counts as anonymous and is never listed', async () => {
      // Window [−40, −35) min: only J2 (claimed@example.com, no verified identity).
      const dto = await onlineAt(35).online({});
      expect(dto.apps).toEqual([{ app: SALES_SLUG, users: 0, anonymous: 1 }]);
      expect(dto.users).toEqual([]);
      expect(JSON.stringify(dto)).not.toContain(CLAIMED_EMAIL);
    });

    it('narrows to one app and to one user key', async () => {
      const service = onlineAt(15);
      expect(await service.online({ app: SALES_SLUG })).toMatchObject({ apps: [], users: [] });
      const hr = await service.online({ app: HR_SLUG });
      expect(hr.users.map((u) => u.email)).toEqual([USER_B]);
      const b = await service.online({ userKey: userKeyHex(USER_B) });
      expect(b.apps).toEqual([{ app: HR_SLUG, users: 1, anonymous: 0 }]);
      expect(b.users.map((u) => u.email)).toEqual([USER_B]);
      expect(await service.online({ userKey: userKeyHex(USER_A) })).toMatchObject({
        apps: [],
        users: [],
      });
      await expect(service.online({ app: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('one row per (app, user), anonymous API sessions counted once each, LIMIT honoured', async () => {
      // The extra rows exist ONLY inside this transaction (rolled back): the shared seed never moves.
      const client = await db.appPool.connect();
      try {
        await client.query('BEGIN');
        const anonymousSessions = [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000001',
        ];
        await new ApiRequestIngestRepository(db.appPool).insertBatch(
          [
            // user a in hr-portal (window [−20, −15), where user b is active too): server-only
            apiRequestRow(seed.appIds.hr, {
              occurredAt: minutesAgo(19.5),
              routeTemplate: '/hr-portal/api/leaves/:id',
              path: '/hr-portal/api/leaves/7',
              sessionId: null,
              userEmail: USER_A,
              userKey: sha256(USER_A),
            }),
            // user b ALSO in ebo-sales: a second row for the same person
            apiRequestRow(seed.appIds.sales, {
              occurredAt: minutesAgo(16),
              sessionId: null,
              userEmail: USER_B,
              userKey: sha256(USER_B),
            }),
            // two anonymous sessions in hr-portal (one of them twice)
            ...anonymousSessions.map((sessionId, i) =>
              apiRequestRow(seed.appIds.hr, {
                occurredAt: minutesAgo(19 + (i + 1) / 10),
                sessionId,
                userEmail: null,
                userKey: null,
                identitySource: 'anonymous',
              }),
            ),
          ],
          client,
        );
        const repo = new WebEventQueryRepository(db.appPool);
        const filter = { from: minutesAgo(20), to: minutesAgo(15), environments: PROD };

        // Busiest app first.
        expect(await repo.countOnlineByApp(filter, client)).toEqual([
          { app_slug: HR_SLUG, users: 2, anonymous: 2 },
          { app_slug: SALES_SLUG, users: 1, anonymous: 0 },
        ]);
        // Most recently active first; user b is two rows (two apps).
        const rows = await repo.listOnlineUsers(filter, 10, client);
        expect(rows.map((r) => [r.app_slug, r.user_email, r.kind, r.events])).toEqual([
          [SALES_SLUG, USER_B, 'api', 1],
          [HR_SLUG, USER_B, 'custom', 3],
          [HR_SLUG, USER_A, 'api', 1],
        ]);
        expect(rows[0]?.current_page).toBeNull(); // b's page views are in hr-portal, not ebo-sales
        expect(rows[1]?.current_page).toBe('/leaves');
        expect(rows[2]).toMatchObject({
          path: '/hr-portal/api/leaves/:id',
          session_id: null,
          current_page: null,
        });
        for (const row of rows) expect(row).not.toHaveProperty('ip');
        const first = await repo.listOnlineUsers(filter, 1, client);
        expect(first.map((r) => [r.app_slug, r.user_email])).toEqual([[SALES_SLUG, USER_B]]);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});
