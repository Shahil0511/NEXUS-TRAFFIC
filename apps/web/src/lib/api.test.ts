import {
  ERROR_CODES,
  INGEST_HEADERS,
  listRoutes,
  NON_DASHBOARD_ROUTE_GROUPS,
  PENDING_ROUTE_LEAVES,
  ROUTES,
} from '@nexus/shared';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { routeUrl, server } from '@/test/msw';

import { api, API_PREFIX, buildApiUrl, buildHeaders, request, toQueryString } from './api';
import { ApiError, NETWORK_ERROR } from './apiError';

/** Groups only other clients call (probes, guide readers, SDKs): no api.* function. */
const NOT_A_DASHBOARD_GROUP = new Set<string>(NON_DASHBOARD_ROUTE_GROUPS);
/** Leaves the API does not serve yet — the SAME list the api route contract test reads. */
const PENDING_LEAVES = new Set<string>(PENDING_ROUTE_LEAVES);

describe('request URL building', () => {
  it('prefixes the basePath + /api mount and fills path params (encoded)', () => {
    expect(API_PREFIX).toBe('/traffic/api');
    expect(buildApiUrl(ROUTES.endpoints.list)).toBe('/traffic/api/v1/endpoints');
    expect(buildApiUrl(ROUTES.apps.revokeKey, undefined, { slug: 'ebo-sales', keyId: 'a/b' })).toBe(
      '/traffic/api/v1/apps/ebo-sales/keys/a%2Fb',
    );
  });

  it('drops empty query values so the API applies its defaults', () => {
    expect(
      toQueryString({ range: '24h', app: undefined, search: '', cursor: null, limit: 50 }),
    ).toBe('?range=24h&limit=50');
    expect(toQueryString(undefined)).toBe('');
    expect(toQueryString({ app: undefined })).toBe('');
  });

  it('sends the CSRF header always and Content-Type only with a body', () => {
    expect(buildHeaders(false)).toEqual({
      Accept: 'application/json',
      [INGEST_HEADERS.dashboard]: '1',
    });
    expect(buildHeaders(true)['Content-Type']).toBe('application/json');
  });
});

describe('request()', () => {
  it('calls the route with same-origin credentials and the dashboard header', async () => {
    let seen: Request | undefined;
    server.use(
      http.get(routeUrl(ROUTES.endpoints.detail), ({ request: req, params }) => {
        seen = req;
        return HttpResponse.json({ id: params.endpointId });
      }),
    );
    const body = await request<{ id: string }, typeof ROUTES.endpoints.detail>(
      ROUTES.endpoints.detail,
      { range: '7d' },
      { params: { endpointId: 'abc' } },
    );
    expect(body).toEqual({ id: 'abc' });
    expect(seen?.headers.get(INGEST_HEADERS.dashboard)).toBe('1');
    expect(seen?.credentials).toBe('same-origin');
    expect(new URL(seen!.url).search).toBe('?range=7d');
  });

  it('sends a JSON body for mutations', async () => {
    let received: unknown;
    server.use(
      http.post(routeUrl(ROUTES.apps.createKey), async ({ request: req }) => {
        received = await req.json();
        return HttpResponse.json({ key: {}, plaintextKey: 'x' }, { status: 201 });
      }),
    );
    await api.apps.createKey('ebo-sales', { kind: 'secret', label: 'prod' });
    expect(received).toEqual({ kind: 'secret', label: 'prod' });
  });

  it('throws a typed ApiError from the error envelope (code, message, requestId)', async () => {
    server.use(
      http.get(routeUrl(ROUTES.overview.summary), () =>
        HttpResponse.json(
          {
            error: {
              code: ERROR_CODES.RANGE_TOO_LARGE,
              message: 'range too large (max 31 days)',
              requestId: 'req-123',
            },
          },
          { status: 400 },
        ),
      ),
    );
    const error = await api.overview.summary({ range: '90d' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe(ERROR_CODES.RANGE_TOO_LARGE);
    expect(apiError.message).toBe('range too large (max 31 days)');
    expect(apiError.requestId).toBe('req-123');
    expect(apiError.isClientError).toBe(true);
  });

  it('falls back to the status and the X-Request-ID header for a non-envelope body', async () => {
    server.use(
      http.get(
        routeUrl(ROUTES.me.get),
        () =>
          new HttpResponse('<html>Bad gateway</html>', {
            status: 502,
            headers: { [INGEST_HEADERS.requestId]: 'edge-9' },
          }),
      ),
    );
    const error = (await api.me.get().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(error.requestId).toBe('edge-9');
    expect(error.isClientError).toBe(false);
  });

  it('wraps network failures in an ApiError with status 0', async () => {
    server.use(http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.error()));
    const error = (await api.apps.list().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(NETWORK_ERROR);
    expect(error.status).toBe(0);
  });

  it('flags 401 as unauthorized (the query client reloads → proxy → portal login)', async () => {
    server.use(
      http.get(routeUrl(ROUTES.me.get), () =>
        HttpResponse.json(
          { error: { code: ERROR_CODES.SESSION_EXPIRED, message: 'expired' } },
          { status: 401 },
        ),
      ),
    );
    const error = (await api.me.get().catch((e: unknown) => e)) as ApiError;
    expect(error.isUnauthorized).toBe(true);
  });
});

describe('routes coverage (leaves the API serves ↔ api.*)', () => {
  const apiTable = api as unknown as Record<string, Record<string, unknown> | undefined>;
  const dashboardLeaves = listRoutes().filter(({ group }) => !NOT_A_DASHBOARD_GROUP.has(group));

  it.each(dashboardLeaves.map(({ group, leaf }) => `${group}.${leaf}`))(
    '%s has an api function exactly when the API serves it',
    (id) => {
      const [group, leaf] = id.split('.') as [string, string];
      const fn = apiTable[group]?.[leaf];
      if (PENDING_LEAVES.has(id)) expect(fn).toBeUndefined();
      else expect(typeof fn).toBe('function');
    },
  );

  it('has no function for a leaf that is not in ROUTES', () => {
    const known = new Set(listRoutes().map(({ group, leaf }) => `${group}.${leaf}`));
    const extra = Object.entries(apiTable).flatMap(([group, leaves]) =>
      Object.keys(leaves ?? {})
        .map((leaf) => `${group}.${leaf}`)
        .filter((id) => !known.has(id)),
    );
    expect(extra).toEqual([]);
  });
});
