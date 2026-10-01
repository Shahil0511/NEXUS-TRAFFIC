/**
 * Test-only factories for the analytics read-side rows (mapper and service tests).
 * WHY: one fully-populated default per row type, so each test states only what it varies.
 */
import type {
  ApiRequestRow,
  EndpointStatsRow,
  TrafficBucketRow,
  TrafficSummaryRow,
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
  return { requests: 100, errors: 5, p95_ms: 200, identified_users: 7, ...overrides };
}
