/**
 * React Query keys — one factory per ROUTES leaf, same group.leaf names as `api` and ROUTES.
 *
 * WHY: a key that mirrors the route makes cache entries traceable ("Find All References" on
 * `qk.endpoints.list` shows the hook) and lets invalidation target a whole group with its
 * prefix (`qk.endpoints.all`). The query object is part of the key, so changing any filter
 * (app, range, sort…) is a new cache entry and a new request.
 */
import type {
  EndpointDetailQuery,
  EndpointListQuery,
  ErrorListQuery,
  ErrorSummaryQuery,
  GeoQuery,
  LiveSnapshotQuery,
  OverviewAppsQuery,
  OverviewSummaryQuery,
  OverviewTimeseriesQuery,
  PageDetailQuery,
  PageListQuery,
  SessionListQuery,
  SessionQuery,
  ToolDetailQuery,
  ToolUsageQuery,
  TopPathsQuery,
  UserActivityQuery,
  UserListQuery,
  UserProfileQuery,
  UserSearchBody,
  UserTimelineQuery,
} from '@nexus/shared';

/** Cursor-paged lists run inside useInfiniteQuery, which owns the cursor — so keys omit it. */
export type EndpointListKeyQuery = Omit<EndpointListQuery, 'cursor'>;
export type ErrorListKeyQuery = Omit<ErrorListQuery, 'cursor'>;
export type UserListKeyQuery = Omit<UserListQuery, 'cursor'>;
export type UserSearchKeyBody = Omit<UserSearchBody, 'cursor'>;
export type UserTimelineKeyQuery = Omit<UserTimelineQuery, 'cursor'>;
export type SessionListKeyQuery = Omit<SessionListQuery, 'cursor'>;

export const qk = {
  me: {
    all: ['me'] as const,
    get: () => ['me', 'get'] as const,
  },
  apps: {
    all: ['apps'] as const,
    list: () => ['apps', 'list'] as const,
  },
  overview: {
    all: ['overview'] as const,
    summary: (q: OverviewSummaryQuery) => ['overview', 'summary', q] as const,
    timeseries: (q: OverviewTimeseriesQuery) => ['overview', 'timeseries', q] as const,
    apps: (q: OverviewAppsQuery) => ['overview', 'apps', q] as const,
  },
  endpoints: {
    all: ['endpoints'] as const,
    list: (q: EndpointListKeyQuery) => ['endpoints', 'list', q] as const,
    detail: (endpointId: string, q: EndpointDetailQuery) =>
      ['endpoints', 'detail', endpointId, q] as const,
  },
  errors: {
    all: ['errors'] as const,
    summary: (q: ErrorSummaryQuery) => ['errors', 'summary', q] as const,
    list: (q: ErrorListKeyQuery) => ['errors', 'list', q] as const,
  },
  users: {
    all: ['users'] as const,
    list: (q: UserListKeyQuery) => ['users', 'list', q] as const,
    activity: (q: UserActivityQuery) => ['users', 'activity', q] as const,
    /** The search text is part of the in-memory key only — never of a URL. */
    search: (q: UserSearchKeyBody) => ['users', 'search', q] as const,
    profile: (userKey: string, q: UserProfileQuery) => ['users', 'profile', userKey, q] as const,
    timeline: (userKey: string, q: UserTimelineKeyQuery) =>
      ['users', 'timeline', userKey, q] as const,
  },
  journeys: {
    all: ['journeys'] as const,
    sessions: (q: SessionListKeyQuery) => ['journeys', 'sessions', q] as const,
    session: (app: string, sessionId: string, q: SessionQuery) =>
      ['journeys', 'session', app, sessionId, q] as const,
    topPaths: (q: TopPathsQuery) => ['journeys', 'topPaths', q] as const,
  },
  pages: {
    all: ['pages'] as const,
    list: (q: PageListQuery) => ['pages', 'list', q] as const,
    detail: (app: string, pageId: string, q: PageDetailQuery) =>
      ['pages', 'detail', app, pageId, q] as const,
  },
  tools: {
    all: ['tools'] as const,
    usage: (q: ToolUsageQuery) => ['tools', 'usage', q] as const,
    detail: (app: string, toolId: string, q: ToolDetailQuery) =>
      ['tools', 'detail', app, toolId, q] as const,
  },
  geo: {
    all: ['geo'] as const,
    countries: (q: GeoQuery) => ['geo', 'countries', q] as const,
    cities: (q: GeoQuery) => ['geo', 'cities', q] as const,
  },
  live: {
    all: ['live'] as const,
    snapshot: (q: LiveSnapshotQuery) => ['live', 'snapshot', q] as const,
  },
  integration: {
    all: ['integration'] as const,
    health: () => ['integration', 'health'] as const,
  },
} as const;
