/**
 * The MSW server of the component tests, plus a helper that turns a ROUTES leaf into the URL
 * pattern the dashboard calls.
 *
 * WHY `routeUrl`: MSW's `:param` syntax equals the ROUTES syntax, so handlers are keyed by the
 * same descriptors as `api.*` — a test can never mock a path the client does not call.
 */
import type { RouteDescriptor } from '@nexus/shared';
import { setupServer } from 'msw/node';

import { API_PREFIX } from '@/lib/api';

export const server = setupServer();

/** `/traffic/api/v1/endpoints/:endpointId` for ROUTES.endpoints.detail, resolved by MSW. */
export function routeUrl(route: RouteDescriptor): string {
  return `${API_PREFIX}${route.path}`;
}
