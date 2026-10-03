/**
 * Deterministic traffic datasets for the read-side suites
 * (test/db/analytics-queries.integration.test.ts and test/e2e/dashboard.integration.test.ts):
 * `seedAnalytics` (S2: API traffic + a few page views, described below) and `seedJourneys`
 * (S3: browser sessions, described above it). Each suite seeds ONE of them into its own database,
 * so the S2 numbers never move when S3 rows are added.
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

import type { BrowserEventType } from '@nexus/shared';
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

/** The two seed apps (ebo-sales, hr-portal), registered like the admin API does. */
async function createSeedApps(db: TestDatabase): Promise<AnalyticsSeed['appIds']> {
  const apps = new AppRepository(db.appPool);
  const newApp = (slug: string, displayName: string) =>
    apps.insert({
      slug,
      displayName,
      basePath: `/${slug}`,
      allowedOrigins: [],
      browserIngestEnabled: true,
      createdBy: 'seed@libas.in',
    });
  return {
    sales: (await newApp(SALES_SLUG, 'EBO Sales')).id,
    hr: (await newApp(HR_SLUG, 'HR')).id,
  };
}

/** Seeds the dataset described in the header (apps, api_requests, web_events). */
export async function seedAnalytics(
  db: TestDatabase,
  now: Date = seedNow(),
): Promise<AnalyticsSeed> {
  const ingest = new ApiRequestIngestRepository(db.appPool);
  const appIds = await createSeedApps(db);
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

// ─── S3: browser sessions (Users, Journeys, Pages & Tools, Geography) ───────
//
// DATASET of `seedJourneys` (minutes before now; range=24h window; pv = page view):
// - J1 ebo-sales, user a (sso_cookie), IP 8.8.8.8, Mumbai (IN/MH):
//     seq0 pv /home −60 · seq1 page_time 4000 ms (pv /home) −59 · seq2 pv /stores/42 −58 ·
//     seq3 tool export-csv −57 · seq4/5 page_time 3000 + 3000 ms (pv /stores/42) −56/−55 ·
//     seq6 pv /reports −54  + API call GET /ebo-sales/api/stores/:id (session J1, user a, no geo) −57.5
// - J2 ebo-sales, client_claimed (claimed@example.com, NOT a user), IP 8.8.4.4, Bengaluru (IN/KA):
//     seq0 pv /home −40 · seq1 pv /home (reload) −39 · seq2 pv /stores/7 −38 ·
//     seq3 page_time 1000 ms (pv /stores/7) −37 · seq4 tool export-csv −36.5 · seq5 pv /reports −36
// - J3 hr-portal, user b (sso_cookie), no IP / geo:
//     seq0 pv /leaves −20 · seq1 tool apply-leave −19 · seq2 custom leave_submitted −18
// - OUTSIDE the window: ebo-sales anonymous pv /home at now − 30 h

const SECOND = 1000;

export const MUMBAI = { country: 'IN', region: 'MH', city: 'Mumbai', lat: 19.076, lon: 72.8777 };
export const BENGALURU = {
  country: 'IN',
  region: 'KA',
  city: 'Bengaluru',
  lat: 12.9716,
  lon: 77.5946,
};
export const CLAIMED_EMAIL = 'claimed@example.com';

/** 64-char hex user keys of the seeded users (how the API addresses them). */
export const userKeyHex = (email: string): string => sha256(email).toString('hex');

export interface JourneySeed {
  now: Date;
  appIds: AnalyticsSeed['appIds'];
  sessions: { j1: string; j2: string; j3: string };
  /** Event ids of J1 in replay order (pv /home, pv /stores/42, API call, tool, pv /reports). */
  j1ReplayIds: string[];
  /** Event ids of user a's timeline, newest first (page_time rows are folded away). */
  userATimelineIds: string[];
}

interface WebEventSpec {
  appId: string;
  at: Date;
  sessionId: string;
  seq: number;
  type: BrowserEventType;
  path: string;
  pathTemplate?: string;
  pageViewId?: string;
  visibleMs?: number;
  tool?: string;
  name?: string;
  user?: string;
  claimedEmail?: string;
  ip?: string;
  geo?: typeof MUMBAI;
}

/** Inserts one browser event as the owner (plain SQL, independent of the ingest code). */
async function insertWebEvent(db: TestDatabase, spec: WebEventSpec): Promise<string> {
  const eventId = randomUUID();
  const identity = spec.user ? 'sso_cookie' : spec.claimedEmail ? 'client_claimed' : 'anonymous';
  const isPageTime = spec.type === 'page_time';
  await db.ownerPool.query(
    `INSERT INTO traffic.web_events
       (occurred_at, event_id, app_id, session_id, seq, event_type, path, path_template,
        page_view_id, visible_ms, is_final, time_reason, tool, name,
        user_email, user_key, claimed_email, identity_source, ip, ip_class,
        geo_country, geo_region, geo_city, geo_lat, geo_lon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
    [
      spec.at,
      eventId,
      spec.appId,
      spec.sessionId,
      spec.seq,
      spec.type,
      spec.path,
      spec.pathTemplate ?? spec.path,
      spec.pageViewId ?? null,
      spec.visibleMs ?? null,
      isPageTime ? false : null,
      isPageTime ? 'route' : null,
      spec.tool ?? null,
      spec.name ?? null,
      spec.user ?? null,
      spec.user ? sha256(spec.user) : null,
      spec.claimedEmail ?? null,
      identity,
      spec.ip ?? null,
      spec.ip ? 'public' : 'unknown',
      spec.geo?.country ?? null,
      spec.geo?.region ?? null,
      spec.geo?.city ?? null,
      spec.geo?.lat ?? null,
      spec.geo?.lon ?? null,
    ],
  );
  return eventId;
}

/** Seeds the S3 dataset described above (apps, web_events, one correlated API call). */
export async function seedJourneys(db: TestDatabase, now: Date = seedNow()): Promise<JourneySeed> {
  const appIds = await createSeedApps(db);
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const sessions = { j1: randomUUID(), j2: randomUUID(), j3: randomUUID() };

  // ─── J1 ───────────────────────────────────────────────────────────────────
  const j1 = {
    appId: appIds.sales,
    sessionId: sessions.j1,
    user: USER_A,
    ip: SEEDED_IP,
    geo: MUMBAI,
  };
  const pv1 = await insertWebEvent(db, {
    ...j1,
    at: ago(60 * MINUTE),
    seq: 0,
    type: 'page_view',
    path: '/home',
  });
  await insertWebEvent(db, {
    ...j1,
    at: ago(59 * MINUTE),
    seq: 1,
    type: 'page_time',
    path: '/home',
    pageViewId: pv1,
    visibleMs: 4000,
  });
  const pv2 = await insertWebEvent(db, {
    ...j1,
    at: ago(58 * MINUTE),
    seq: 2,
    type: 'page_view',
    path: '/stores/42',
    pathTemplate: '/stores/:id',
  });
  const tool1 = await insertWebEvent(db, {
    ...j1,
    at: ago(57 * MINUTE),
    seq: 3,
    type: 'tool_use',
    path: '/stores/42',
    pathTemplate: '/stores/:id',
    tool: 'export-csv',
  });
  await insertWebEvent(db, {
    ...j1,
    at: ago(56 * MINUTE),
    seq: 4,
    type: 'page_time',
    path: '/stores/42',
    pathTemplate: '/stores/:id',
    pageViewId: pv2,
    visibleMs: 3000,
  });
  await insertWebEvent(db, {
    ...j1,
    at: ago(55 * MINUTE),
    seq: 5,
    type: 'page_time',
    path: '/stores/42',
    pathTemplate: '/stores/:id',
    pageViewId: pv2,
    visibleMs: 3000,
  });
  const pv3 = await insertWebEvent(db, {
    ...j1,
    at: ago(54 * MINUTE),
    seq: 6,
    type: 'page_view',
    path: '/reports',
  });
  const call = apiRequestRow(appIds.sales, {
    occurredAt: ago(57 * MINUTE + 30 * SECOND),
    endpointId: ENDPOINT_IDS.storeLookup,
    routeTemplate: ROUTE.storeLookup.template,
    path: '/ebo-sales/api/stores/42',
    sessionId: sessions.j1,
    userEmail: USER_A,
    userKey: sha256(USER_A),
    identitySource: 'app_attested',
    geoCountry: null,
    geoRegion: null,
    geoCity: null,
    geoLat: null,
    geoLon: null,
  });
  await new ApiRequestIngestRepository(db.appPool).insertBatch([call]);

  // ─── J2 ───────────────────────────────────────────────────────────────────
  const j2 = {
    appId: appIds.sales,
    sessionId: sessions.j2,
    claimedEmail: CLAIMED_EMAIL,
    ip: '8.8.4.4',
    geo: BENGALURU,
  };
  await insertWebEvent(db, {
    ...j2,
    at: ago(40 * MINUTE),
    seq: 0,
    type: 'page_view',
    path: '/home',
  });
  await insertWebEvent(db, {
    ...j2,
    at: ago(39 * MINUTE),
    seq: 1,
    type: 'page_view',
    path: '/home',
  });
  const pv6 = await insertWebEvent(db, {
    ...j2,
    at: ago(38 * MINUTE),
    seq: 2,
    type: 'page_view',
    path: '/stores/7',
    pathTemplate: '/stores/:id',
  });
  await insertWebEvent(db, {
    ...j2,
    at: ago(37 * MINUTE),
    seq: 3,
    type: 'page_time',
    path: '/stores/7',
    pathTemplate: '/stores/:id',
    pageViewId: pv6,
    visibleMs: 1000,
  });
  await insertWebEvent(db, {
    ...j2,
    at: ago(36 * MINUTE + 30 * SECOND),
    seq: 4,
    type: 'tool_use',
    path: '/stores/7',
    pathTemplate: '/stores/:id',
    tool: 'export-csv',
  });
  await insertWebEvent(db, {
    ...j2,
    at: ago(36 * MINUTE),
    seq: 5,
    type: 'page_view',
    path: '/reports',
  });

  // ─── J3 ───────────────────────────────────────────────────────────────────
  const j3 = { appId: appIds.hr, sessionId: sessions.j3, user: USER_B };
  await insertWebEvent(db, {
    ...j3,
    at: ago(20 * MINUTE),
    seq: 0,
    type: 'page_view',
    path: '/leaves',
  });
  await insertWebEvent(db, {
    ...j3,
    at: ago(19 * MINUTE),
    seq: 1,
    type: 'tool_use',
    path: '/leaves',
    tool: 'apply-leave',
  });
  await insertWebEvent(db, {
    ...j3,
    at: ago(18 * MINUTE),
    seq: 2,
    type: 'custom',
    path: '/leaves',
    name: 'leave_submitted',
  });

  // ─── outside the window ───────────────────────────────────────────────────
  await insertWebEvent(db, {
    appId: appIds.sales,
    sessionId: randomUUID(),
    at: ago(30 * HOUR),
    seq: 0,
    type: 'page_view',
    path: '/home',
  });

  return {
    now,
    appIds,
    sessions,
    j1ReplayIds: [pv1, pv2, call.eventId, tool1, pv3],
    userATimelineIds: [pv3, tool1, call.eventId, pv2, pv1],
  };
}

/** What the S3 suites assert for `seedJourneys` at range=24h. */
export const JOURNEY_EXPECTED = {
  /** Most recently seen first: b (−18 min), then a (−54 min). */
  users: [
    { email: USER_B, requests: 0, pageViews: 1, sessions: 1, apps: [HR_SLUG] },
    { email: USER_A, requests: 1, pageViews: 3, sessions: 1, apps: [SALES_SLUG] },
  ],
  pages: [
    {
      app: SALES_SLUG,
      pathTemplate: '/home',
      views: 3,
      uniqueSessions: 2,
      avgVisibleMs: 4000,
      p50VisibleMs: 4000,
      exits: 0,
    },
    {
      app: SALES_SLUG,
      pathTemplate: '/reports',
      views: 2,
      uniqueSessions: 2,
      avgVisibleMs: null,
      p50VisibleMs: null,
      exits: 2,
    },
    {
      app: SALES_SLUG,
      pathTemplate: '/stores/:id',
      views: 2,
      uniqueSessions: 2,
      avgVisibleMs: 3500,
      p50VisibleMs: 3500,
      exits: 0,
    },
    {
      app: HR_SLUG,
      pathTemplate: '/leaves',
      views: 1,
      uniqueSessions: 1,
      avgVisibleMs: null,
      p50VisibleMs: null,
      exits: 1,
    },
  ],
  topPaths: [{ app: SALES_SLUG, steps: ['/home', '/stores/:id', '/reports'], sessions: 2 }],
  countries: [
    { country: 'IN', requests: 0, pageViews: 7, users: 1 },
    { country: null, requests: 1, pageViews: 1, users: 2 },
  ],
} as const;
