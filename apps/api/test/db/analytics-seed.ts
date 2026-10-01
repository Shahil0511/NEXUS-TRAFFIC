/**
 * One deterministic traffic dataset for the S2 read-side suites
 * (test/db/analytics-queries.integration.test.ts and test/e2e/dashboard.integration.test.ts).
 *
 * WHY ONE MODULE: both suites assert the same numbers (counts, error rate, percentiles, buckets),
 * so the rows and the expected values live side by side and cannot drift apart.
 *
 * TIME: `seedNow()` is 06:30 UTC (= 12:00 IST) on day 11 of the CURRENT UTC month, so every seeded
 * row lands in a partition the migrate run created (previous month … +2 months) whatever day the
 * suite runs. Services under test get a FixedClock at that instant. With range=24h the window is
 * [now − 24h, now) (grain hour, IST-aligned buckets start at :30 UTC) and the previous window is
 * [now − 48h, now − 24h).
 *
 * DATASET (current window unless stated)
 * - ebo-sales  GET  /ebo-sales/api/stores/:id     10 × 200, 10…100 ms, user a       (now − 120 … − 111 min)
 * - ebo-sales  POST /ebo-sales/api/reports/export  500, 500, 404, 200 (1000…4000 ms, user b, IP 8.8.8.8)
 *                                                  + 1 stream 200 of 600 000 ms     (now − 300 … − 255 min)
 * - hr-portal  GET  /hr-portal/api/leaves          401, 401, 503, 200, 200, 200 (5 ms, anonymous session S)
 *                                                  at now − 30, −29, −28, −27, −2, −1 min
 * - previous window: stores/:id 5 × 200 (10 ms, user c) at now − 30 h
 * - OUTSIDE both windows: a 500 at exactly `now` (to is exclusive) and a 500 at now − 48 h − 1 min
 * - µs keyset block: 5 × 503 on leaves around now − 72 h, same millisecond, distinct microseconds
 * - web_events page views: now − 180 min (sales, anon W), now − 3 min (hr, session S),
 *   now − 1 min (sales, user a); previous window: now − 30 h (sales, anon W)
 */
import { randomUUID } from 'node:crypto';

import { toEndpointId } from '@nexus/shared/endpoint-id';

import type { ApiRequestInsert } from '../../src/domain/inserts';
import { ApiRequestIngestRepository } from '../../src/repositories/api-request-ingest.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { apiRequestRow, sha256 } from './fixtures';
import { utcMonthStart, type TestDatabase } from './test-database';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SALES_SLUG = 'ebo-sales';
export const HR_SLUG = 'hr-portal';
/** The only IP that is ever seeded on a row a non-admin can see (asserted absent from their payloads). */
export const SEEDED_IP = '8.8.8.8';

export const USER_A = 'a@libas.in';
export const USER_B = 'b@libas.in';
export const USER_C = 'c@libas.in';

export const ROUTE = {
  storeLookup: { slug: SALES_SLUG, method: 'GET', template: '/ebo-sales/api/stores/:id' },
  reportExport: { slug: SALES_SLUG, method: 'POST', template: '/ebo-sales/api/reports/export' },
  leaveList: { slug: HR_SLUG, method: 'GET', template: '/hr-portal/api/leaves' },
} as const;
type RouteName = keyof typeof ROUTE;

/** Stored endpoint ids (uuid v5, exactly as ingest computes them). */
export const ENDPOINT_IDS: Record<RouteName, string> = {
  storeLookup: toEndpointId(
    ROUTE.storeLookup.slug,
    ROUTE.storeLookup.method,
    ROUTE.storeLookup.template,
  ),
  reportExport: toEndpointId(
    ROUTE.reportExport.slug,
    ROUTE.reportExport.method,
    ROUTE.reportExport.template,
  ),
  leaveList: toEndpointId(ROUTE.leaveList.slug, ROUTE.leaveList.method, ROUTE.leaveList.template),
};

/** When the six leaves calls happen (minutes before now): four early, two inside "active now". */
const LEAVE_MINUTES_AGO = [30, 29, 28, 27, 2, 1];

/** 06:30 UTC (12:00 IST) on day 11 of the current UTC month — see the header. */
export function seedNow(): Date {
  return new Date(utcMonthStart(new Date()).getTime() + 10 * DAY + 6 * HOUR + 30 * MINUTE);
}

/** Start of the µs keyset block (now − 72 h); its rows differ only below the millisecond. */
export function microsecondBlockAt(now: Date): Date {
  return new Date(now.getTime() - 3 * DAY);
}

/** `percentile_cont(fraction)` (linear interpolation), to check SQL percentiles independently. */
export function percentileCont(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? Number.NaN;
  const high = sorted[upper] ?? Number.NaN;
  return low + (high - low) * (position - lower);
}

/** Durations of the http rows (latency kind) per route in the current window. */
export const HTTP_DURATIONS: Record<RouteName, number[]> = {
  storeLookup: Array.from({ length: 10 }, (_, i) => (i + 1) * 10),
  reportExport: [1000, 2000, 3000, 4000],
  leaveList: [5, 5, 5, 5, 5, 5],
};

/** What the suites assert (current window = range 24h at seedNow()). */
export const EXPECTED = {
  requests: 21,
  failures: 6,
  errors4xx: 3,
  errors5xx: 3,
  identifiedUsers: 2,
  previousRequests: 5,
  previousIdentifiedUsers: 1,
  pageViews: 3,
  previousPageViews: 1,
  /** Last 5 minutes: anonymous session S (api + web, counted once) and user a (web). */
  activeUsersNow: 2,
  calls: { storeLookup: 10, reportExport: 5, leaveList: 6 },
} as const;

export interface AnalyticsSeed {
  now: Date;
  appIds: { sales: string; hr: string };
  /** Event ids of the failed requests of the current window, newest first. */
  failureIds: string[];
  /** Event ids of the µs keyset block, newest first (occurred_at DESC, event_id DESC). */
  microsecondIds: string[];
}

interface RowSpec {
  route: RouteName;
  at: Date;
  status: number;
  durationMs: number;
  kind?: 'http' | 'stream';
  user?: string | null;
  sessionId?: string;
  ip?: string;
}

/** A full ApiRequestInsert for one spec (identified when `user` is set, else anonymous). */
function toInsert(spec: RowSpec, appIds: AnalyticsSeed['appIds']): ApiRequestInsert {
  const route = ROUTE[spec.route];
  const user = spec.user ?? null;
  return apiRequestRow(route.slug === SALES_SLUG ? appIds.sales : appIds.hr, {
    occurredAt: spec.at,
    eventId: randomUUID(),
    endpointId: ENDPOINT_IDS[spec.route],
    kind: spec.kind ?? 'http',
    method: route.method,
    routeTemplate: route.template,
    path: route.template.replace(':id', '42'),
    statusCode: spec.status,
    durationMs: spec.durationMs,
    sessionId: spec.sessionId ?? randomUUID(),
    userEmail: user,
    userKey: user ? sha256(user) : null,
    identitySource: user ? 'app_attested' : 'anonymous',
    ip: spec.ip ?? '10.1.2.3',
    ipClass: spec.ip ? 'public' : 'private',
  });
}

/** Inserts one browser page view (S3 has no web ingest repository yet, so plain SQL as owner). */
async function insertPageView(
  db: TestDatabase,
  appId: string,
  at: Date,
  sessionId: string,
  user: string | null,
): Promise<void> {
  await db.ownerPool.query(
    `INSERT INTO traffic.web_events
       (occurred_at, event_id, app_id, session_id, seq, event_type, path, path_template,
        user_email, user_key, identity_source, ip_class)
     VALUES ($1, $2, $3, $4, 0, 'page_view', '/home', '/home', $5, $6, $7, 'unknown')`,
    [
      at,
      randomUUID(),
      appId,
      sessionId,
      user,
      user ? sha256(user) : null,
      user ? 'sso_cookie' : 'anonymous',
    ],
  );
}

/** Seeds the dataset described in the header (apps, api_requests, web_events). */
export async function seedAnalytics(
  db: TestDatabase,
  now: Date = seedNow(),
): Promise<AnalyticsSeed> {
  const apps = new AppRepository(db.appPool);
  const ingest = new ApiRequestIngestRepository(db.appPool);
  const newApp = (slug: string, displayName: string) =>
    apps.insert({
      slug,
      displayName,
      basePath: `/${slug}`,
      allowedOrigins: [],
      browserIngestEnabled: true,
      createdBy: 'seed@libas.in',
    });
  const appIds = {
    sales: (await newApp(SALES_SLUG, 'EBO Sales')).id,
    hr: (await newApp(HR_SLUG, 'HR')).id,
  };
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const anonSession = randomUUID();
  const webSession = randomUUID();

  const specs: RowSpec[] = [
    ...HTTP_DURATIONS.storeLookup.map((durationMs, i) => ({
      route: 'storeLookup' as const,
      at: ago(120 * MINUTE - i * MINUTE),
      status: 200,
      durationMs,
      user: USER_A,
    })),
    ...[500, 500, 404, 200].map((status, i) => ({
      route: 'reportExport' as const,
      at: ago(300 * MINUTE - i * 10 * MINUTE),
      status,
      durationMs: HTTP_DURATIONS.reportExport[i] ?? 0,
      user: USER_B,
      ip: SEEDED_IP,
    })),
    {
      route: 'reportExport',
      at: ago(255 * MINUTE),
      status: 200,
      durationMs: 600_000,
      kind: 'stream',
      user: USER_B,
    },
    ...[401, 401, 503, 200, 200, 200].map((status, i) => ({
      route: 'leaveList' as const,
      at: ago((LEAVE_MINUTES_AGO[i] ?? 0) * MINUTE),
      status,
      durationMs: 5,
      sessionId: anonSession,
    })),
    // previous window
    ...Array.from({ length: 5 }, (_, i) => ({
      route: 'storeLookup' as const,
      at: ago(30 * HOUR - i * MINUTE),
      status: 200,
      durationMs: 10,
      user: USER_C,
    })),
    // outside both windows
    { route: 'storeLookup', at: now, status: 500, durationMs: 10, user: USER_A },
    {
      route: 'storeLookup',
      at: ago(48 * HOUR + MINUTE),
      status: 500,
      durationMs: 10,
      user: USER_A,
    },
  ];
  const rows = specs.map((spec) => toInsert(spec, appIds));
  await ingest.insertBatch(rows);

  const failureIds = rows
    .filter((row) => row.statusCode >= 400 && row.occurredAt < now && row.occurredAt >= ago(DAY))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((row) => row.eventId);

  const microsecondIds = await seedMicrosecondBlock(db, ingest, appIds, microsecondBlockAt(now));

  await insertPageView(db, appIds.sales, ago(180 * MINUTE), webSession, null);
  await insertPageView(db, appIds.hr, ago(3 * MINUTE), anonSession, null);
  await insertPageView(db, appIds.sales, ago(MINUTE), randomUUID(), USER_A);
  await insertPageView(db, appIds.sales, ago(30 * HOUR), webSession, null);

  return { now, appIds, failureIds, microsecondIds };
}

/**
 * Five failures in the SAME millisecond that differ only in microseconds (two share one instant, so
 * event_id breaks the tie). A cursor built from a JS Date would truncate to the millisecond and
 * repeat or skip rows; the suites page through them and expect each id exactly once.
 */
async function seedMicrosecondBlock(
  db: TestDatabase,
  ingest: ApiRequestIngestRepository,
  appIds: AnalyticsSeed['appIds'],
  at: Date,
): Promise<string[]> {
  const offsetsUs = [0, 1, 2, 3, 3];
  const rows = offsetsUs.map(() =>
    toInsert({ route: 'leaveList', at, status: 503, durationMs: 5 }, appIds),
  );
  await ingest.insertBatch(rows);
  for (const [i, row] of rows.entries()) {
    await db.ownerPool.query(
      `UPDATE traffic.api_requests
          SET occurred_at = occurred_at + make_interval(secs => $1::float8 / 1000000)
        WHERE event_id = $2`,
      [offsetsUs[i], row.eventId],
    );
  }
  return rows
    .map((row, i) => ({ id: row.eventId, us: offsetsUs[i] ?? 0 }))
    .sort((a, b) => b.us - a.us || (a.id < b.id ? 1 : -1))
    .map((entry) => entry.id);
}
