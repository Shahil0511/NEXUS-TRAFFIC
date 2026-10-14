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
  ERROR_CODES,
  type EndpointStatsDto,
  type FailedRequestDto,
  type TimelineItemDto,
} from '@nexus/shared';

import { createQueryPool } from '../../src/db/pool';
import type { Viewer } from '../../src/domain/viewer';
import { FixedClock } from '../../src/lib/clock';
import { ApiRequestQueryRepository } from '../../src/repositories/api-request-query.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { WebEventQueryRepository } from '../../src/repositories/web-event-query.repository';
import { AppSlugResolver } from '../../src/services/app-slug.resolver';
import { EndpointService } from '../../src/services/endpoint.service';
import { ErrorService } from '../../src/services/error.service';
import { GeoService } from '../../src/services/geo.service';
import { JourneyService } from '../../src/services/journey.service';
import { OverviewService } from '../../src/services/overview.service';
import { PageService } from '../../src/services/page.service';
import { ToolService } from '../../src/services/tool.service';
import { UserService } from '../../src/services/user.service';
import {
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
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const HOUR = 3_600_000;
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
    errors = new ErrorService(requests, appSlugs, clock);
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
        { from: new Date(seed.now.getTime() - 24 * HOUR), to: seed.now },
        'day',
      );
      const istMidnight = new Date(seed.now.getTime() - 12 * HOUR); // now is 12:00 IST
      expect(rows.map((r) => r.bucket.toISOString())).toEqual([istMidnight.toISOString()]);
      expect(rows[0]?.requests).toBe(EXPECTED.requests);
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
      const dto = await errors.summary({ range: '24h' });
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
      const all = await errors.summary({ range: '24h' });
      expect(all.usersAffected).toBe(all.topAffectedUsers.length);
      const top = all.topAffectedUsers[0];
      if (top) {
        const one = await errors.summary({ range: '24h', userKey: top.userKey });
        expect(one.total).toBe(top.count);
        expect(one.usersAffected).toBe(1);
      }
    });

    it('scopes every number to one route when endpointId is given', async () => {
      const all = await errors.summary({ range: '24h' });
      const route = all.topEndpoints.find((e) => e.endpointId === ENDPOINT_IDS.leaveList)!;
      const dto = await errors.summary({ range: '24h', endpointId: ENDPOINT_IDS.leaveList });
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
      const dto = await errors.summary({ range: '24h' });
      expect(dto.byErrorCode).toEqual([
        { errorCode: 'UPSTREAM_TIMEOUT', count: 3, routes: 2 },
        { errorCode: 'AUTH_EXPIRED', count: 2, routes: 1 },
        { errorCode: null, count: 1, routes: 1 },
      ]);
    });

    it('scopes the summary and the list to one code', async () => {
      const dto = await errors.summary({ range: '24h', errorCode: 'UPSTREAM_TIMEOUT' });
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
      const dto = await errors.summary({ range: '24h', errorCode: 'UPSTREAM_TIMEOUT' });
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
      const auth = await errors.summary({ range: '24h', errorCode: 'AUTH_EXPIRED' });
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
  let journeys: JourneyService;
  let pages: PageService;
  let tools: ToolService;
  let geo: GeoService;

  beforeAll(async () => {
    db = await createTestDatabase('journeys');
    seed = await seedJourneys(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    const webEvents = new WebEventQueryRepository(queryPool);
    const appSlugs = new AppSlugResolver(new AppRepository(queryPool));
    const clock = new FixedClock(seed.now);
    const requests = new ApiRequestQueryRepository(queryPool);
    users = new UserService(webEvents, requests, appSlugs, clock);
    journeys = new JourneyService(webEvents, appSlugs, clock);
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
      const dto = await users.profile(userKeyHex(USER_A), { range: '24h' });
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
      await expect(users.profile('0'.repeat(64), { range: '24h' })).rejects.toMatchObject({
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

    it('timeline: non-admins never receive an IP', async () => {
      const page = await users.timeline(userKeyHex(USER_A), { range: '24h', limit: 50 }, VIEWER);
      expect(page.items).toHaveLength(5);
      expect(JSON.stringify(page)).not.toContain(SEEDED_IP);
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
      const dto = await users.profile(userKeyHex(USER_A), { range: '24h' });
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
    const hourBefore = () => ({ from: new Date(seed.now.getTime() - HOUR), to: seed.now });

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
});
