/**
 * Typed DTO samples for the component tests — typed with the shared DTOs, so a contract change
 * breaks the fixtures at compile time instead of silently drifting.
 */
import type {
  AppDto,
  CursorPage,
  EndpointDetailDto,
  EndpointStatsDto,
  ErrorSummaryDto,
  FailedRequestDto,
  MeDto,
  OverviewSummaryDto,
  OverviewTimeseriesDto,
  TimeseriesPointDto,
  TimeWindowDto,
} from '@nexus/shared';

export const WINDOW: TimeWindowDto = {
  from: '2026-09-30T08:00:00.000Z',
  to: '2026-10-01T08:00:00.000Z',
  grain: 'hour',
};

export const ME: MeDto = { email: 'viewer@libas.in', isAdmin: true };

export const APPS: AppDto[] = [
  {
    slug: 'ebo-sales',
    displayName: 'EBO Sales',
    basePath: '/ebo',
    allowedOrigins: ['https://nexus.libas.in'],
    isActive: true,
    browserIngestEnabled: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    keys: [],
  },
];

export const OVERVIEW_SUMMARY: OverviewSummaryDto = {
  window: WINDOW,
  requests: { value: 12_345, previous: 10_000, deltaPct: 23.45 },
  errorRate: { value: 2.5, previous: 2, deltaPct: 25 },
  p95Ms: { value: 840, previous: 900, deltaPct: -6.67 },
  pageViews: { value: 3_210, previous: null, deltaPct: null },
  identifiedUsers: { value: 42, previous: 40, deltaPct: 5 },
  activeUsersNow: 7,
};

export function timeseriesPoint(bucket: string, requests: number): TimeseriesPointDto {
  return { bucket, requests, errors4xx: 2, errors5xx: 1, p95Ms: 420, pageViews: 10 };
}

export const OVERVIEW_TIMESERIES: OverviewTimeseriesDto = {
  window: WINDOW,
  points: [
    timeseriesPoint('2026-10-01T06:00:00.000Z', 100),
    timeseriesPoint('2026-10-01T07:00:00.000Z', 140),
  ],
};

export function endpointStats(overrides: Partial<EndpointStatsDto> = {}): EndpointStatsDto {
  return {
    endpointId: '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11',
    app: 'ebo-sales',
    method: 'GET',
    routeTemplate: '/api/orders/:id',
    calls: 1_200,
    errors4xx: 12,
    errors5xx: 3,
    errorRate: 1.25,
    p50Ms: 80,
    p95Ms: 420,
    p99Ms: 980,
    avgMs: 120,
    lastSeenAt: '2026-10-01T07:59:00.000Z',
    ...overrides,
  };
}

export const ENDPOINT_PAGE: CursorPage<EndpointStatsDto> = {
  items: [
    endpointStats(),
    endpointStats({
      endpointId: '0b8e4c55-77a1-5d0c-8c11-5e2a9d7c4b22',
      method: 'POST',
      routeTemplate: '/api/orders',
      calls: 300,
    }),
  ],
  nextCursor: null,
};

export function failedRequest(eventId: string, status = 500): FailedRequestDto {
  return {
    eventId,
    occurredAt: '2026-10-01T07:30:00.000Z',
    app: 'ebo-sales',
    kind: 'http',
    method: 'GET',
    path: '/api/orders/123',
    routeTemplate: '/api/orders/:id',
    endpointId: '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11',
    status,
    durationMs: 1_234,
    errorCode: 'ORDER_LOOKUP_FAILED',
    requestId: `req-${eventId.slice(0, 4)}`,
    actor: {
      userKey: null,
      userEmail: 'buyer@libas.in',
      claimedEmail: null,
      identitySource: 'app_attested',
      ip: '203.0.113.7',
      geo: { country: 'IN', region: 'MH', city: 'Mumbai' },
    },
  };
}

export const ERROR_SUMMARY: ErrorSummaryDto = {
  window: WINDOW,
  total: 15,
  errors4xx: 12,
  errors5xx: 3,
  byStatus: [
    { status: 404, count: 12 },
    { status: 500, count: 3 },
  ],
  timeseries: OVERVIEW_TIMESERIES.points,
  topEndpoints: [endpointStats()],
};

export const ENDPOINT_DETAIL: EndpointDetailDto = {
  window: WINDOW,
  endpoint: endpointStats(),
  timeseries: OVERVIEW_TIMESERIES.points,
  statusBreakdown: [
    { status: 200, count: 1_185 },
    { status: 404, count: 12 },
  ],
  slowest: [failedRequest('9d7a3c1e-1111-4a2b-9c3d-4e5f6a7b8c9d', 200)],
};
