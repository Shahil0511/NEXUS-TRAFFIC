/**
 * Build the absolute URL of an ingest endpoint.
 *
 * WHY: one rule for every SDK, snippet and the dashboard's integration panel, so teams never
 * produce three different URL shapes. `baseUrl` is NEXUS_URL WITHOUT `/api`:
 *   buildIngestUrl('https://nexus.libas.in/traffic', ROUTES.ingest.server)
 *     → 'https://nexus.libas.in/traffic/api/v1/ingest/server'
 * ZERO dependencies.
 */
import type { RouteDescriptor } from '../routes';

export const DEFAULT_NEXUS_URL = 'https://nexus.libas.in/traffic';

export function buildIngestUrl(baseUrl: string, route: RouteDescriptor): string {
  return `${baseUrl.replace(/\/+$/, '')}/api${route.path}`;
}
