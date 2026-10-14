/**
 * Typed DTO samples for the component tests — typed with the shared DTOs, so a contract change
 * breaks the fixtures at compile time instead of silently drifting.
 */
import type {
  AppTrafficDto,
  AppDto,
  CursorPage,
  EndpointDetailDto,
  EndpointStatsDto,
  ErrorSummaryDto,
  FailedRequestDto,
  GeoCityDto,
  GeoCountryDto,
  MeDto,
  OverviewSummaryDto,
  OverviewTimeseriesDto,
  PageStatsDto,
  SessionDetailDto,
  SessionEventDto,
  SessionSummaryDto,
  TimelineItemDto,
  TimelineItemKind,
  TimeseriesPointDto,
  TimeWindowDto,
  ToolUsageDto,
  TopPathDto,
  UserProfileDto,
  UserSummaryDto,
  WindowedListDto,
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

export function appTraffic(overrides: Partial<AppTrafficDto> = {}): AppTrafficDto {
  return {
    app: 'ebo-sales',
    displayName: 'EBO Sales',
    requests: { value: 9_000, previous: 6_000, deltaPct: 50 },
    errorRate: { value: 1.5, previous: 3, deltaPct: -50 },
    p95Ms: 320,
    pageViews: { value: 2_400, previous: 2_000, deltaPct: 20 },
    users: { value: 38, previous: 30, deltaPct: 26.67 },
    sessions: 120,
    toolUses: 64,
    lastEventAt: '2026-10-01T07:59:00.000Z',
    ...overrides,
  };
}

export const APP_TRAFFIC: WindowedListDto<AppTrafficDto> = {
  window: WINDOW,
  items: [
    appTraffic(),
    appTraffic({
      app: 'hr-portal',
      displayName: 'HR Portal',
      requests: { value: 0, previous: 0, deltaPct: null },
      errorRate: { value: null, previous: null, deltaPct: null },
      p95Ms: null,
      pageViews: { value: 0, previous: 0, deltaPct: null },
      users: { value: 0, previous: 0, deltaPct: null },
      sessions: 0,
      toolUses: 0,
      lastEventAt: null,
    }),
  ],
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
    sessionId: null,
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

// ─── S3: users, journeys, pages, tools, geography ───────────────────────────

/** A valid userKey (64 hex chars, the shape of the API's HMAC). */
export const USER_KEY = 'a'.repeat(64);
export const SESSION_ID = '7c1d2e3f-4a5b-4c6d-8e7f-001122334455';

export function userSummary(overrides: Partial<UserSummaryDto> = {}): UserSummaryDto {
  return {
    userKey: USER_KEY,
    email: 'buyer@libas.in',
    lastSeenAt: '2026-10-01T07:45:00.000Z',
    requests: 1_234,
    pageViews: 56,
    sessions: 7,
    apps: ['ebo-sales'],
    ...overrides,
  };
}

export const USER_PROFILE: UserProfileDto = {
  summary: userSummary(),
  firstSeenAt: '2026-09-30T09:00:00.000Z',
  failedRequests: 12,
  topTools: [{ app: 'ebo-sales', tool: 'export-csv', uses: 9 }],
  topPages: [{ app: 'ebo-sales', pathTemplate: '/orders/:id', views: 31 }],
  countries: ['IN'],
};

export function timelineItem(
  eventId: string,
  kind: TimelineItemKind,
  overrides: Partial<TimelineItemDto> = {},
): TimelineItemDto {
  return {
    eventId,
    occurredAt: '2026-10-01T07:40:00.000Z',
    kind,
    app: 'ebo-sales',
    path: '/orders/123',
    sessionId: SESSION_ID,
    identitySource: 'sso_cookie',
    method: kind === 'api' ? 'GET' : null,
    status: kind === 'api' ? 200 : null,
    durationMs: kind === 'api' ? 84 : null,
    tool: kind === 'tool_use' ? 'export-csv' : null,
    visibleMs: kind === 'page_view' ? 65_000 : null,
    name: null,
    endpointId: kind === 'api' ? '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11' : null,
    ip: null,
    ...overrides,
  };
}

export function sessionSummary(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    app: 'ebo-sales',
    sessionId: SESSION_ID,
    startedAt: '2026-10-01T07:30:00.000Z',
    lastSeenAt: '2026-10-01T07:42:00.000Z',
    durationMs: 720_000,
    pageViews: 4,
    toolUses: 2,
    visibleMs: 540_000,
    userKey: USER_KEY,
    userEmail: 'buyer@libas.in',
    claimedEmail: null,
    identitySource: 'sso_cookie',
    entryPath: '/orders',
    exitPath: '/orders/:id',
    country: 'IN',
    ip: null,
    ...overrides,
  };
}

/** A claimed (browser-hint) identity: shown, flagged, never a user. */
export const CLAIMED_SESSION = sessionSummary({
  sessionId: '8d2e3f40-5b6c-4d7e-9f80-112233445566',
  userKey: null,
  userEmail: null,
  claimedEmail: 'someone@libas.in',
  identitySource: 'client_claimed',
  ip: '203.0.113.9',
});

export function sessionEvent(
  eventId: string,
  kind: TimelineItemKind,
  overrides: Partial<SessionEventDto> = {},
): SessionEventDto {
  return {
    eventId,
    occurredAt: '2026-10-01T07:30:00.000Z',
    seq: null,
    kind,
    path: '/orders',
    tool: kind === 'tool_use' ? 'export-csv' : null,
    visibleMs: kind === 'page_view' ? 42_000 : null,
    name: kind === 'custom' ? 'filter-applied' : null,
    method: kind === 'api' ? 'GET' : null,
    status: kind === 'api' ? 200 : null,
    durationMs: kind === 'api' ? 120 : null,
    endpointId: kind === 'api' ? '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11' : null,
    ...overrides,
  };
}

export const SESSION_DETAIL: SessionDetailDto = {
  summary: sessionSummary(),
  events: [
    sessionEvent('e1', 'page_view', { seq: 1 }),
    sessionEvent('e2', 'tool_use', { seq: 2, occurredAt: '2026-10-01T07:30:42.000Z' }),
    sessionEvent('e3', 'api', {
      occurredAt: '2026-10-01T07:30:43.000Z',
      path: '/api/orders/export',
      status: 500,
    }),
    sessionEvent('e4', 'page_view', {
      seq: 3,
      occurredAt: '2026-10-01T07:31:05.000Z',
      path: '/orders/:id',
      visibleMs: 125_000,
    }),
  ],
};

export const TOP_PATHS: WindowedListDto<TopPathDto> = {
  window: WINDOW,
  items: [{ app: 'ebo-sales', steps: ['/', '/orders', '/orders/:id'], sessions: 18 }],
};

export const PAGE_STATS: WindowedListDto<PageStatsDto> = {
  window: WINDOW,
  items: [
    {
      app: 'ebo-sales',
      pathTemplate: '/orders/:id',
      views: 420,
      uniqueSessions: 200,
      avgVisibleMs: 48_000,
      p50VisibleMs: 31_000,
      exits: 50,
    },
    {
      app: 'ebo-sales',
      pathTemplate: '/reports',
      views: 12,
      uniqueSessions: 10,
      avgVisibleMs: null,
      p50VisibleMs: null,
      exits: 0,
    },
  ],
};

export const TOOL_USAGE: WindowedListDto<ToolUsageDto> = {
  window: WINDOW,
  items: [
    {
      app: 'ebo-sales',
      tool: 'export-csv',
      uses: 1_250,
      distinctUsers: 34,
      distinctSessions: 80,
      lastUsedAt: '2026-10-01T07:55:00.000Z',
      trend: [
        { bucket: '2026-10-01T06:00:00.000Z', uses: 3 },
        { bucket: '2026-10-01T07:00:00.000Z', uses: 40 },
      ],
    },
  ],
};

export const GEO_COUNTRIES: WindowedListDto<GeoCountryDto> = {
  window: WINDOW,
  items: [
    { country: 'IN', requests: 9_800, pageViews: 600, users: 40 },
    { country: 'AE', requests: 120, pageViews: 0, users: 2 },
    { country: null, requests: 15, pageViews: 3, users: 0 },
  ],
};

export const GEO_CITIES: WindowedListDto<GeoCityDto> = {
  window: WINDOW,
  items: [
    {
      country: 'IN',
      region: 'Maharashtra',
      city: 'Mumbai',
      lat: 19.07,
      lon: 72.88,
      requests: 7_000,
      pageViews: 450,
      users: 30,
    },
  ],
};
