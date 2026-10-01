/**
 * Re-exports of the zero-dependency contract helpers in @nexus/shared.
 *
 * WHY wrappers with explicit signatures (not `export … from`): the published .d.ts must not
 * mention @nexus/shared, which consumers do not have — the code itself is bundled.
 */
import {
  buildIngestUrl as sharedBuildIngestUrl,
  DEFAULT_NEXUS_URL as SHARED_DEFAULT_NEXUS_URL,
} from '@nexus/shared/ingest/build-ingest-url';
import { resolveClientIp as sharedResolveClientIp } from '@nexus/shared/ingest/client-ip';
import { ROUTES } from '@nexus/shared/routes';

/** The production NEXUS_URL (without `/api`). */
export const DEFAULT_NEXUS_URL: string = SHARED_DEFAULT_NEXUS_URL;

/**
 * The end-user IP, walking X-Forwarded-For from the RIGHT by the number of proxies YOU run
 * (gateway → app = 1; gateway → Next.js → API = 2). NEVER the leftmost entry: clients forge it.
 */
export function resolveClientIp(
  xForwardedFor: string | string[] | undefined | null,
  remoteAddress: string | undefined | null,
  trustProxyHops: number,
): string | null {
  return sharedResolveClientIp(xForwardedFor, remoteAddress, trustProxyHops);
}

/** Which ingest endpoint to address. */
export type IngestEndpoint = 'server' | 'browser' | 'verify';

/**
 * Absolute URL of an ingest endpoint from NEXUS_URL (WITHOUT `/api`):
 * buildIngestUrl('https://nexus.libas.in/traffic') → 'https://nexus.libas.in/traffic/api/v1/ingest/server'.
 */
export function buildIngestUrl(baseUrl: string, endpoint: IngestEndpoint = 'server'): string {
  return sharedBuildIngestUrl(baseUrl, ROUTES.ingest[endpoint]);
}
