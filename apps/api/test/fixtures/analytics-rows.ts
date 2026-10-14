/**
 * Test-only factories for the analytics read-side rows (mapper and service tests).
 * WHY: one fully-populated default per row type, so each test states only what it varies.
 */
import type {
  ApiRequestRow,
  EndpointStatsRow,
  GeoCityRow,
  OnlineUserRow,
  PageStatsRow,
  SessionEventRow,
  SessionSummaryRow,
  TimelineEventRow,
  ToolUsageRow,
  TrafficBucketRow,
  TrafficSummaryRow,
  UserSummaryRow,
} from '../../src/domain/rows';

export const ENDPOINT_ID = '33333333-3333-5333-8333-333333333333';
export const EVENT_ID = '44444444-4444-4444-8444-444444444444';
export const OCCURRED_AT = new Date('2026-10-01T09:15:30.250Z');
export const ADMIN_VIEWER = { email: 'boss@libas.in', isAdmin: true } as const;
export const PLAIN_VIEWER = { email: 'viewer@libas.in', isAdmin: false } as const;

export function apiRequestSampleRow(overrides: Partial<ApiRequestRow> = {}): ApiRequestRow {
  return {
    occurred_at: OCCURRED_AT,
    occurred_at_key: '2026-10-01T09:15:30.250000Z',
    event_id: EVENT_ID,
    app_slug: 'ebo-sales',
    endpoint_id: ENDPOINT_ID,
    kind: 'http',
    method: 'POST',
    route_template: '/ebo-sales/api/v1/reports/export',
    path: '/ebo-sales/api/v1/reports/export',
    status_code: 500,
    duration_ms: 1290.4000244140625,
    error_code: 'REPORT_TIMEOUT',
    request_id: 'req-1',
    session_id: null,
    user_email: 'someone@libas.in',
    user_key: Buffer.alloc(32, 0xab),
    claimed_email: null,
    identity_source: 'app_attested',
    ip: '8.8.8.8',
    ip_class: 'public',
    geo_country: 'US',
    geo_region: 'CA',
    geo_city: 'Mountain View',
    ...overrides,
  };
}

export function endpointStatsRow(overrides: Partial<EndpointStatsRow> = {}): EndpointStatsRow {
  return {
    endpoint_id: ENDPOINT_ID,
    app_slug: 'ebo-sales',
    method: 'GET',
    route_template: '/ebo-sales/api/v1/stores/:id',
    calls: 200,
    errors_4xx: 6,
    errors_5xx: 2,
    p50_ms: 41.70000076293945,
    p95_ms: 120.25,
    p99_ms: 480,
    avg_ms: 55.123456,
    last_seen_at: OCCURRED_AT,
    ...overrides,
  };
}

export function trafficBucketRow(overrides: Partial<TrafficBucketRow> = {}): TrafficBucketRow {
  return {
    bucket: new Date('2026-10-01T08:30:00.000Z'),
    requests: 10,
    errors_4xx: 1,
    errors_5xx: 1,
    p95_ms: 99.5,
    ...overrides,
  };
}

export function trafficSummaryRow(overrides: Partial<TrafficSummaryRow> = {}): TrafficSummaryRow {
  return { requests: 100, errors: 5, p95_ms: 200, ...overrides };
}

// ─── S3 browser analytics rows ──────────────────────────────────────────────

export const USER_KEY = Buffer.alloc(32, 0xab);
export const USER_KEY_HEX = USER_KEY.toString('hex');
export const SESSION_ID = '55555555-5555-4555-8555-555555555555';
export const APP_ID = '11111111-1111-4111-8111-111111111111';

export function userSummaryRow(overrides: Partial<UserSummaryRow> = {}): UserSummaryRow {
  return {
    user_key: USER_KEY,
    user_email: 'someone@libas.in',
    first_seen_at: new Date('2026-10-01T08:00:00.000Z'),
    last_seen_at: OCCURRED_AT,
    requests: 12,
    failed_requests: 2,
    page_views: 5,
    sessions: 2,
    apps: ['ebo-sales', 'hr-portal'],
    ...overrides,
  };
}

export function timelineEventRow(overrides: Partial<TimelineEventRow> = {}): TimelineEventRow {
  return {
    occurred_at: OCCURRED_AT,
    occurred_at_key: '2026-10-01T09:15:30.250000Z',
    event_id: EVENT_ID,
    kind: 'page_view',
    app_slug: 'ebo-sales',
    path: '/stores/42',
    session_id: SESSION_ID,
    identity_source: 'sso_cookie',
    method: null,
    status_code: null,
    duration_ms: null,
    tool: null,
    visible_ms: 4200,
    name: null,
    endpoint_id: null,
    ip: '8.8.8.8',
    ...overrides,
  };
}

export function sessionSummaryRow(overrides: Partial<SessionSummaryRow> = {}): SessionSummaryRow {
  return {
    app_slug: 'ebo-sales',
    session_id: SESSION_ID,
    started_at: new Date('2026-10-01T09:00:00.000Z'),
    last_seen_at: OCCURRED_AT,
    duration_ms: 930250.4,
    page_views: 3,
    tool_uses: 1,
    visible_ms: 10000,
    user_key: USER_KEY,
    user_email: 'someone@libas.in',
    claimed_email: null,
    identity_source: 'sso_cookie',
    entry_path: '/home',
    exit_path: '/reports',
    country: 'IN',
    ip: '8.8.8.8',
    ...overrides,
  };
}

export function sessionEventRow(overrides: Partial<SessionEventRow> = {}): SessionEventRow {
  return {
    event_id: EVENT_ID,
    occurred_at: OCCURRED_AT,
    seq: 0,
    kind: 'page_view',
    path: '/home',
    tool: null,
    visible_ms: null,
    name: null,
    method: null,
    status_code: null,
    duration_ms: null,
    endpoint_id: null,
    ...overrides,
  };
}

export function pageStatsRow(overrides: Partial<PageStatsRow> = {}): PageStatsRow {
  return {
    app_slug: 'ebo-sales',
    path_template: '/stores/:id',
    views: 20,
    unique_sessions: 8,
    distinct_users: 5,
    avg_visible_ms: 3500.4999,
    p50_visible_ms: 3000.5,
    exits: 3,
    ...overrides,
  };
}

export function toolUsageRow(overrides: Partial<ToolUsageRow> = {}): ToolUsageRow {
  return {
    app_id: APP_ID,
    app_slug: 'ebo-sales',
    tool: 'export-csv',
    uses: 7,
    distinct_users: 2,
    distinct_sessions: 4,
    last_used_at: OCCURRED_AT,
    ...overrides,
  };
}

export function geoCityRow(overrides: Partial<GeoCityRow> = {}): GeoCityRow {
  return {
    country: 'IN',
    region: 'MH',
    city: 'Mumbai',
    lat: 19.07600021362305,
    lon: 72.87770080566406,
    requests: 4,
    page_views: 6,
    users: 2,
    ...overrides,
  };
}

// ─── Live: who is online ────────────────────────────────────────────────────

/** A verified user whose newest event is an API call (label = route template, never the path). */
export function onlineUserRow(overrides: Partial<OnlineUserRow> = {}): OnlineUserRow {
  return {
    app_slug: 'ebo-sales',
    user_key: USER_KEY,
    user_email: 'someone@libas.in',
    session_id: SESSION_ID,
    kind: 'api',
    path: '/ebo-sales/api/v1/stores/:id',
    tool: null,
    method: 'GET',
    status_code: 200,
    endpoint_id: ENDPOINT_ID,
    last_seen_at: OCCURRED_AT,
    events: 3,
    current_page: '/stores/:id',
    ...overrides,
  };
}
