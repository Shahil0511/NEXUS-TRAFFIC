/**
 * The MSW server of the component tests, plus a helper that turns a ROUTES leaf into the URL
 * pattern the dashboard calls.
 *
 * WHY `routeUrl`: MSW's `:param` syntax equals the ROUTES syntax, so handlers are keyed by the
 * same descriptors as `api.*` — a test can never mock a path the client does not call.
 */
import { ROUTES, type RouteDescriptor } from '@nexus/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { API_PREFIX } from '@/lib/api';

import { ME } from './fixtures';

/**
 * Default handler: the viewer is an ADMIN (ME), so person links render as in production for an
 * admin. A test about a plain viewer overrides ROUTES.me.get with server.use.
 */
export const server = setupServer(
  http.get(`${API_PREFIX}${ROUTES.me.get.path}`, () => HttpResponse.json(ME)),
);

/** `/traffic/api/v1/endpoints/:endpointId` for ROUTES.endpoints.detail, resolved by MSW. */
export function routeUrl(route: RouteDescriptor): string {
  return `${API_PREFIX}${route.path}`;
}
