/**
 * Collector URLs of the browser SDK — a LEAF module (the early entry imports it, so it must not
 * pull in the tracker).
 *
 * WHY: teams pass NEXUS_URL (e.g. `https://nexus.libas.in/traffic`); every endpoint is derived
 * with the same `buildIngestUrl` rule as every other SDK. A full endpoint URL is accepted too.
 */
import { buildIngestUrl } from '@nexus/shared/ingest/build-ingest-url';
import { ROUTES } from '@nexus/shared/routes';

/** `/api/v1/ingest/…` — derived with the same rule, so the `/api` prefix is never hand-typed. */
const BROWSER_SUFFIX = buildIngestUrl('', ROUTES.ingest.browser);
const CONFIG_SUFFIX = buildIngestUrl('', ROUTES.ingest.config);

/** WHY: NEXUS_URL → `…/api/v1/ingest/browser`; a full ingest URL is returned unchanged. */
export function resolveIngestUrl(url: string): string {
  return buildIngestUrl(collectorBase(url), ROUTES.ingest.browser);
}

/** WHY: the remote-config endpoint (POST, ADR 0009), from the same NEXUS_URL. */
export function resolveConfigUrl(url: string): string {
  return buildIngestUrl(collectorBase(url), ROUTES.ingest.config);
}

/** WHY: header propagation must never decorate the SDK's own requests (they stay simple requests). */
export function ingestExcludeUrls(url: string): string[] {
  return [resolveIngestUrl(url), resolveConfigUrl(url)];
}

/** WHY: one base resolution for every endpoint — strips a trailing slash and a known endpoint suffix. */
function collectorBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  for (const suffix of [BROWSER_SUFFIX, CONFIG_SUFFIX]) {
    if (trimmed.endsWith(suffix)) return trimmed.slice(0, -suffix.length);
  }
  return trimmed;
}
