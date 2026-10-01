/**
 * S2 end to end, in process: the REAL container (createContainer) and app (createApp) against a
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
  type CursorPage,
  type EndpointDetailDto,
  type EndpointStatsDto,
  type ErrorSummaryDto,
  type FailedRequestDto,
  type OverviewSummaryDto,
  type OverviewTimeseriesDto,
  type RouteDescriptor,
} from '@nexus/shared';
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
  seedAnalytics,
  SEEDED_IP,
  type AnalyticsSeed,
} from '../db/analytics-seed';
import { createTestDatabase, RUN_DB_TESTS, type TestDatabase } from '../db/test-database';
import { signAccessToken } from '../fixtures/sign-access-token';
import { silentLogger } from '../ingest-fixtures';

const JWT_SECRET = 'e2e-dashboard-jwt-secret-'.padEnd(48, 'x');
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

  it('endpoints.detail: admins see the IP of the slowest calls', async () => {
    const path = buildPath(ROUTES.endpoints.detail, { endpointId: ENDPOINT_IDS.reportExport });
    const res = await get(ROUTES.endpoints.detail, ADMIN_EMAIL, {}, path);
    expect(res.status).toBe(200);
    const body = res.body as EndpointDetailDto;
    expect(body.endpoint.calls).toBe(EXPECTED.calls.reportExport);
    expect(body.slowest[0]?.actor.ip).toBe(SEEDED_IP);
  });

  it('endpoints.detail: a non-admin NEVER receives an IP', async () => {
    const path = buildPath(ROUTES.endpoints.detail, { endpointId: ENDPOINT_IDS.reportExport });
    const res = await get(ROUTES.endpoints.detail, VIEWER_EMAIL, {}, path);
    expect(res.status).toBe(200);
    expect((res.body as EndpointDetailDto).slowest.every((s) => s.actor.ip === null)).toBe(true);
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
});
