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
  OverviewSummaryQuery,
  OverviewTimeseriesQuery,
} from '@nexus/shared';

/** Cursor-paged lists run inside useInfiniteQuery, which owns the cursor — so keys omit it. */
export type EndpointListKeyQuery = Omit<EndpointListQuery, 'cursor'>;
export type ErrorListKeyQuery = Omit<ErrorListQuery, 'cursor'>;

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
} as const;
