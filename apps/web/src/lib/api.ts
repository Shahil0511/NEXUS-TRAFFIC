/**
 * THE dashboard API client — one arrow function per implemented ROUTES leaf.
 *
 * WHY: this is the web half of the ctrl-click chain (ai-context/05-conventions.md §1).
 * "Find All References" on e.g. `ROUTES.endpoints.list` lands here AND on the Express route table
 * (apps/api/src/http/routes/index.ts). Paths are NEVER typed by hand: `request()` fills the
 * ROUTES descriptor with `buildPath()` and prefixes `${PUBLIC_BASE_PATH}/api` (nginx strips
 * `/traffic` in production; the dev rewrite in next.config.ts does the same locally).
 * Query and response types come from @nexus/shared (query schemas + DTOs), so both sides of
 * the HTTP boundary share one definition.
 *
 * Every call sends `X-Nexus-Dashboard: 1` (the API's CSRF guard) with same-origin credentials
 * (the SSO `access_token` cookie), and throws a typed ApiError built from the error envelope.
 *
 * @see ./api.test.ts   the coverage test: every registered dashboard leaf has a function here
 */
import {
  buildPath,
  INGEST_HEADERS,
  PUBLIC_BASE_PATH,
  ROUTES,
  type ApiKeyDto,
  type AppCreatedDto,
  type AppDto,
  type CreateAppBody,
  type CreateKeyBody,
  type CursorPage,
  type EndpointDetailDto,
  type EndpointDetailQuery,
  type EndpointListQuery,
  type EndpointStatsDto,
  type ErrorListQuery,
  type ErrorSummaryDto,
  type ErrorSummaryQuery,
  type ExpireKeyBody,
  type FailedRequestDto,
  type KeyCreatedDto,
  type MeDto,
  type OverviewSummaryDto,
  type OverviewSummaryQuery,
  type OverviewTimeseriesDto,
  type OverviewTimeseriesQuery,
  type PathParams,
  type RouteDescriptor,
  type UpdateAppBody,
} from '@nexus/shared';

import { toApiError, toNetworkError } from './apiError';

/** Mount point of the Express router (apps/api/src/app.ts: app.use('/api', …)). */
export const API_PREFIX = `${PUBLIC_BASE_PATH}/api`;

/** The CSRF header value the API requires on every dashboard call. */
export const DASHBOARD_HEADER_VALUE = '1';
const JSON_MEDIA_TYPE = 'application/json';

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestOptions<R extends RouteDescriptor = RouteDescriptor> {
  /** Values for the `:param` segments of the route path. */
  params?: PathParams<R>;
  /** React Query passes its AbortSignal so unmounted/obsolete queries cancel their fetch. */
  signal?: AbortSignal;
  /** JSON request body (admin mutations); sent with Content-Type: application/json. */
  body?: unknown;
}

/** Serialise a query object; empty values are dropped so the API applies its own defaults. */
export function toQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Full same-origin URL of a ROUTES leaf, e.g. `/traffic/api/v1/endpoints/…?range=24h`. */
export function buildApiUrl<R extends RouteDescriptor>(
  route: R,
  query?: QueryParams,
  params?: PathParams<R>,
): string {
  return `${API_PREFIX}${buildPath(route, params)}${toQueryString(query)}`;
}

/** Headers of every dashboard call (+ Content-Type when a JSON body is sent). */
export function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: JSON_MEDIA_TYPE,
    [INGEST_HEADERS.dashboard]: DASHBOARD_HEADER_VALUE,
  };
  if (hasBody) headers['Content-Type'] = JSON_MEDIA_TYPE;
  return headers;
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/** Perform one API call and decode its JSON body; non-2xx → ApiError. */
export async function request<T, R extends RouteDescriptor = RouteDescriptor>(
  route: R,
  query?: QueryParams,
  options: RequestOptions<R> = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(buildApiUrl(route, query, options.params), {
      method: route.method,
      credentials: 'same-origin',
      headers: buildHeaders(hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    if (isAbort(cause)) throw cause; // React Query treats this as a cancellation, not a failure
    throw toNetworkError(cause);
  }
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/** Options without path params or body, for the generated call signatures below. */
type CallOptions = Pick<RequestOptions, 'signal'>;

/**
 * One function per implemented leaf; key names mirror ROUTES exactly (group.leaf).
 * S3–S5 add users/journeys/pages/tools/geo/live/integration (the Apps admin UI arrives in S5,
 * its mutations are already here because the API serves them since S1).
 */
export const api = {
  me: {
    get: (o?: CallOptions) => request<MeDto>(ROUTES.me.get, undefined, o),
  },
  apps: {
    list: (o?: CallOptions) => request<AppDto[]>(ROUTES.apps.list, undefined, o),
    create: (body: CreateAppBody, o?: CallOptions) =>
      request<AppCreatedDto>(ROUTES.apps.create, undefined, { ...o, body }),
    update: (slug: string, body: UpdateAppBody, o?: CallOptions) =>
      request<AppDto, typeof ROUTES.apps.update>(ROUTES.apps.update, undefined, {
        ...o,
        body,
        params: { slug },
      }),
    createKey: (slug: string, body: CreateKeyBody, o?: CallOptions) =>
      request<KeyCreatedDto, typeof ROUTES.apps.createKey>(ROUTES.apps.createKey, undefined, {
        ...o,
        body,
        params: { slug },
      }),
    expireKey: (slug: string, keyId: string, body: ExpireKeyBody, o?: CallOptions) =>
      request<ApiKeyDto, typeof ROUTES.apps.expireKey>(ROUTES.apps.expireKey, undefined, {
        ...o,
        body,
        params: { slug, keyId },
      }),
    revokeKey: (slug: string, keyId: string, o?: CallOptions) =>
      request<ApiKeyDto, typeof ROUTES.apps.revokeKey>(ROUTES.apps.revokeKey, undefined, {
        ...o,
        params: { slug, keyId },
      }),
  },
  overview: {
    summary: (q: OverviewSummaryQuery, o?: CallOptions) =>
      request<OverviewSummaryDto>(ROUTES.overview.summary, q, o),
    timeseries: (q: OverviewTimeseriesQuery, o?: CallOptions) =>
      request<OverviewTimeseriesDto>(ROUTES.overview.timeseries, q, o),
  },
  endpoints: {
    list: (q: EndpointListQuery, o?: CallOptions) =>
      request<CursorPage<EndpointStatsDto>>(ROUTES.endpoints.list, q, o),
    detail: (endpointId: string, q: EndpointDetailQuery, o?: CallOptions) =>
      request<EndpointDetailDto, typeof ROUTES.endpoints.detail>(ROUTES.endpoints.detail, q, {
        ...o,
        params: { endpointId },
      }),
  },
  errors: {
    summary: (q: ErrorSummaryQuery, o?: CallOptions) =>
      request<ErrorSummaryDto>(ROUTES.errors.summary, q, o),
    list: (q: ErrorListQuery, o?: CallOptions) =>
      request<CursorPage<FailedRequestDto>>(ROUTES.errors.list, q, o),
  },
} as const;
