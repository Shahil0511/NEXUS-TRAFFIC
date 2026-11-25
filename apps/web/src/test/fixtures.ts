/**
 * Typed DTO samples for the component tests — typed with the shared DTOs, so a contract change
 * breaks the fixtures at compile time instead of silently drifting.
 */
import type {
  AppTrafficDto,
  BreakdownDto,
  DeviceReturnDto,
  UserActivityDto,
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
  UserDailyActivityDto,
  UserDayActivityDto,
  UserDayAppActivityDto,
  UserDayDetailDto,
  UserActivityPatternDto,
  UserDevicesDto,
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
    sdkConfig: { version: 1, disabledModules: [], updatedAt: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    keys: [],
  },
];

/** ROUTES.overview.breakdown — browsers; one null value (not sent) and a free-text value. */
export const BREAKDOWN: BreakdownDto = {
  window: WINDOW,
  source: 'browser',
  dimension: 'browser',
  total: 1_000,
  items: [
    { value: 'Chrome', events: 640, share: 0.64 },
    { value: 'Safari', events: 250, share: 0.25 },
    { value: null, events: 10, share: 0.01 },
  ],
};

/** ROUTES.overview.devices */
export const DEVICE_RETURN: DeviceReturnDto = {
  window: WINDOW,
  lookbackFrom: '2026-08-31T08:00:00.000Z',
  devices: 200,
  newDevices: 50,
  returningDevices: 150,
};

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
    identifiedPct: 96.5,
    linkedPct: 71.2,
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
      identifiedPct: null,
      linkedPct: null,
    }),
  ],
};

export const USER_ACTIVITY: UserActivityDto = {
  window: WINDOW,
  points: [
    { day: '2026-09-29T18:30:00.000Z', users: 21 },
    { day: '2026-09-30T18:30:00.000Z', users: 25 },
  ],
  wau: 31,
  mau: 38,
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
  usersAffected: 4,
  topAffectedUsers: [
    {
      userKey: 'a'.repeat(64),
      email: 'buyer@libas.in',
      count: 9,
      lastSeenAt: '2026-10-01T07:40:00.000Z',
    },
  ],
  byErrorCode: [
    { errorCode: 'QUERY_TIMEOUT', count: 9, routes: 2 },
    { errorCode: 'SERVICE_UNAVAILABLE', count: 3, routes: 1 },
    { errorCode: null, count: 3, routes: 1 },
  ],
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
  uniqueUsers: 3,
  topUsers: [
    {
      userKey: 'a'.repeat(64),
      email: 'buyer@libas.in',
      count: 800,
      lastSeenAt: '2026-10-01T07:40:00.000Z',
    },
  ],
};

// ─── S3: users, journeys, pages, tools, geography ───────────────────────────

/** A valid userKey (64 hex chars, the shape of the API's HMAC). */
export const USER_KEY = 'a'.repeat(64);
/** Opaque page / tool ids (the API computes them; any uuid works here). */
export const PAGE_ID = '0d6e9a51-3f7e-5a7e-9a51-2a596f1c3f7e';
export const TOOL_ID = '1a2b3c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d';
export const SESSION_ID = '7c1d2e3f-4a5b-4c6d-8e7f-001122334455';

export function userSummary(overrides: Partial<UserSummaryDto> = {}): UserSummaryDto {
  return {
    userKey: USER_KEY,
    email: 'buyer@libas.in',
    lastSeenAt: '2026-10-01T07:45:00.000Z',
    requests: 1_234,
    pageViews: 56,
    sessions: 7,
    failedRequests: 12,
    firstSeenAt: '2026-09-30T09:00:00.000Z',
    apps: ['ebo-sales'],
    ...overrides,
  };
}

export const USER_PROFILE: UserProfileDto = {
  summary: userSummary(),
  firstSeenAt: '2026-09-30T09:00:00.000Z',
  failedRequests: 12,
  topTools: [{ toolId: TOOL_ID, app: 'ebo-sales', tool: 'export-csv', uses: 9 }],
  topPages: [{ pageId: PAGE_ID, app: 'ebo-sales', pathTemplate: '/orders/:id', views: 31 }],
  topEndpoints: [
    {
      endpointId: '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11',
      app: 'ebo-sales',
      method: 'GET',
      routeTemplate: '/api/orders/:id',
      calls: 1_100,
      failed: 12,
    },
  ],
  perApp: [
    {
      app: 'ebo-sales',
      requests: 1_234,
      pageViews: 56,
      toolUses: 9,
      sessions: 7,
      lastSeenAt: '2026-10-01T07:45:00.000Z',
    },
  ],
  countries: ['IN'],
  latest: {
    seenAt: '2026-10-01T07:45:00.000Z',
    app: 'ebo-sales',
    device: 'desktop',
    browser: 'Chrome 126',
    os: 'Windows 10',
    timeZone: 'Asia/Kolkata',
    language: 'en-IN',
    appVersion: '2026.11.3',
  },
};

/** The window every person-page fixture echoes (the last 7 days ending 1 Oct 08:00 UTC). */
const PERSON_WINDOW = {
  from: '2026-09-24T08:00:00.000Z',
  to: '2026-10-01T08:00:00.000Z',
  grain: 'hour',
} as const;

export const USER_DEVICES: UserDevicesDto = {
  window: PERSON_WINDOW,
  items: [
    {
      device: 'desktop',
      browser: 'Chrome 126',
      os: 'Windows 10',
      firstSeenAt: '2026-09-30T09:00:00.000Z',
      lastSeenAt: '2026-10-01T07:45:00.000Z',
      pageViews: 50,
      requests: 1_200,
      visits: 6,
      apps: ['ebo-sales'],
    },
    {
      device: null,
      browser: null,
      os: null,
      firstSeenAt: '2026-09-30T10:00:00.000Z',
      lastSeenAt: '2026-09-30T11:00:00.000Z',
      pageViews: 0,
      requests: 34,
      visits: 0,
      apps: ['ebo-sales'],
    },
  ],
};

/**
 * The whole IST days of USER_DAILY's 7d window (the API widens it: 24 Sep 00:00 → 2 Oct 00:00
 * IST).
 */
const DAILY_WINDOW = {
  from: '2026-09-23T18:30:00.000Z',
  to: '2026-10-01T18:30:00.000Z',
  grain: 'hour',
} as const;

/** One app of one day (UserDayActivityDto.perApp line); the defaults are 1 Oct's ebo-sales. */
export function userDayApp(
  app: string,
  overrides: Partial<UserDayAppActivityDto> = {},
): UserDayAppActivityDto {
  return {
    app,
    firstActivityAt: '2026-10-01T03:40:00.000Z',
    lastActivityAt: '2026-10-01T13:10:00.000Z',
    activeMs: 11_520_000,
    pageViews: 40,
    requests: 900,
    failedRequests: 3,
    toolUses: 5,
    visits: 4,
    ...overrides,
  };
}

/**
 * One day built from its app lines the way the API folds it (foldUserDays): perApp in first-use
 * order (then slug), the counts and tab visible time their Σ, first / last their min / max, apps
 * the sorted slugs. Fixtures use it so a day can never disagree with its own apps.
 */
export function userDayFrom(
  day: string,
  apps: readonly UserDayAppActivityDto[],
  inProgress = false,
): UserDayActivityDto {
  const perApp = [...apps].sort(
    (a, b) => a.firstActivityAt.localeCompare(b.firstActivityAt) || a.app.localeCompare(b.app),
  );
  const sum = (pick: (app: UserDayAppActivityDto) => number): number =>
    perApp.reduce((total, app) => total + pick(app), 0);
  const times = (pick: (app: UserDayAppActivityDto) => string): string[] => perApp.map(pick).sort();
  return {
    day,
    firstActivityAt: times((app) => app.firstActivityAt)[0] ?? day,
    lastActivityAt: times((app) => app.lastActivityAt).at(-1) ?? day,
    activeMs: sum((app) => app.activeMs),
    pageViews: sum((app) => app.pageViews),
    requests: sum((app) => app.requests),
    failedRequests: sum((app) => app.failedRequests),
    toolUses: sum((app) => app.toolUses),
    visits: sum((app) => app.visits),
    apps: perApp.map((app) => app.app).sort(),
    inProgress,
    perApp,
  };
}

/**
 * Two IST days, newest first. 1 Oct: 09:10 → 18:40 IST, 3 h 12 min visible. 30 Sep: 10:00 →
 * 13:20 IST, 48 min visible. Averages: first 09:35, last 16:00; total 4 h.
 */
export const USER_DAILY: UserDailyActivityDto = {
  window: DAILY_WINDOW,
  items: [
    userDayFrom('2026-09-30T18:30:00.000Z', [userDayApp('ebo-sales')]),
    userDayFrom('2026-09-29T18:30:00.000Z', [
      userDayApp('ebo-sales', {
        firstActivityAt: '2026-09-30T04:30:00.000Z',
        lastActivityAt: '2026-09-30T07:50:00.000Z',
        activeMs: 2_880_000,
        pageViews: 16,
        requests: 334,
        failedRequests: 0,
        toolUses: 4,
        visits: 3,
      }),
    ]),
  ],
};

/**
 * ONE IST day (1 Oct 2026) of the person, as ROUTES.users.day answers it. hr-portal is used first
 * (07:30-08:00 IST, 10 min on screen), then ebo-sales (09:10-18:40 IST, 3 h 12 min). Two blocks;
 * time in app 3 h (tabs overlapped in the second block), tab visible time 3 h 22 min. 50 API calls
 * fall outside the blocks; 2 of 32 pages, 1 feature and 2 of 5 visits are listed.
 */
export const USER_DAY_DETAIL: UserDayDetailDto = {
  window: { from: '2026-09-30T18:30:00.000Z', to: '2026-10-01T18:30:00.000Z', grain: 'hour' },
  day: '2026-10-01',
  summary: userDayFrom('2026-09-30T18:30:00.000Z', [
    userDayApp('ebo-sales'),
    userDayApp('hr-portal', {
      firstActivityAt: '2026-10-01T02:00:00.000Z',
      lastActivityAt: '2026-10-01T02:30:00.000Z',
      activeMs: 600_000,
      pageViews: 2,
      requests: 0,
      failedRequests: 0,
      toolUses: 0,
      visits: 1,
    }),
  ]),
  timeInAppMs: 10_800_000,
  blocks: [
    {
      startAt: '2026-10-01T02:00:00.000Z',
      endAt: '2026-10-01T02:30:00.000Z',
      spanMs: 1_800_000,
      timeInAppMs: 600_000,
      activeMs: 600_000,
      apps: ['hr-portal'],
      pageViews: 2,
      toolUses: 0,
      requests: 0,
    },
    {
      startAt: '2026-10-01T03:40:00.000Z',
      endAt: '2026-10-01T13:10:00.000Z',
      spanMs: 34_200_000,
      timeInAppMs: 10_200_000,
      activeMs: 11_520_000,
      apps: ['ebo-sales'],
      pageViews: 40,
      toolUses: 5,
      requests: 850,
    },
  ],
  blockCount: 2,
  blocksTruncated: false,
  requestsOutsideBlocks: 50,
  pages: [
    {
      pageId: PAGE_ID,
      app: 'hr-portal',
      pathTemplate: '/leaves',
      firstViewAt: '2026-10-01T02:00:00.000Z',
      views: 2,
      activeMs: 600_000,
    },
    {
      pageId: '0d6e9a51-3f7e-5a7e-9a51-2a596f1c3f7f',
      app: 'ebo-sales',
      pathTemplate: '/stores/:id',
      firstViewAt: '2026-10-01T03:40:00.000Z',
      views: 40,
      activeMs: 11_520_000,
    },
  ],
  pagesTotal: 32,
  tools: [
    {
      toolId: TOOL_ID,
      app: 'ebo-sales',
      tool: 'export-csv',
      firstUseAt: '2026-10-01T04:00:00.000Z',
      uses: 5,
    },
  ],
  toolsTotal: 1,
  visits: [
    {
      app: 'ebo-sales',
      sessionId: SESSION_ID,
      startedAt: '2026-10-01T03:40:00.000Z',
      lastActivityAt: '2026-10-01T13:10:00.000Z',
      entryPath: '/home',
      exitPath: '/stores/:id',
      pageViews: 40,
      toolUses: 5,
      activeMs: 11_520_000,
    },
    {
      app: 'hr-portal',
      sessionId: '7c1d2e3f-4a5b-4c6d-8e7f-001122334466',
      startedAt: '2026-10-01T02:00:00.000Z',
      lastActivityAt: '2026-10-01T02:30:00.000Z',
      entryPath: '/leaves',
      exitPath: '/leaves',
      pageViews: 2,
      toolUses: 0,
      activeMs: 600_000,
    },
  ],
};

/** The same day with no activity: a 200 with no summary and empty lists. */
export const EMPTY_USER_DAY: UserDayDetailDto = {
  ...USER_DAY_DETAIL,
  summary: null,
  timeInAppMs: 0,
  blocks: [],
  blockCount: 0,
  requestsOutsideBlocks: 0,
  pages: [],
  pagesTotal: 0,
  tools: [],
  toolsTotal: 0,
  visits: [],
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
      pageId: PAGE_ID,
      app: 'ebo-sales',
      pathTemplate: '/orders/:id',
      views: 420,
      uniqueSessions: 200,
      distinctUsers: 64,
      avgVisibleMs: 48_000,
      p50VisibleMs: 31_000,
      exits: 50,
    },
    {
      pageId: '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6e',
      app: 'ebo-sales',
      pathTemplate: '/reports',
      views: 12,
      uniqueSessions: 10,
      distinctUsers: 6,
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
      toolId: TOOL_ID,
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

/**
 * The usual activity hours of the last 30 days (1 Sep - 1 Oct 2026, 31 whole IST days): Tuesday
 * 10:00 on 4 of 5 Tuesdays with 2 h 10 min tab visible time, Thursday 09:00 on 2 of 5, and one
 * Sunday 23:00 (of 4) with API calls only.
 */
export const USER_PATTERN: UserActivityPatternDto = {
  window: { from: '2026-08-31T18:30:00.000Z', to: '2026-10-01T18:30:00.000Z', grain: 'day' },
  activeDays: 9,
  weekdayDays: [4, 5, 5, 5, 4, 4, 4],
  cells: [
    { weekday: 2, hour: 10, activeDays: 4, activeMs: 7_800_000 },
    { weekday: 4, hour: 9, activeDays: 2, activeMs: 3_600_000 },
    { weekday: 7, hour: 23, activeDays: 1, activeMs: 0 },
  ],
};

/** The same range with no activity: a 200 with no cells. */
export const EMPTY_USER_PATTERN: UserActivityPatternDto = {
  ...USER_PATTERN,
  activeDays: 0,
  cells: [],
};
