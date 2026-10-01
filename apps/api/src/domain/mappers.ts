/**
 * Row → DTO mappers: the ONLY place snake_case PostgreSQL rows become the camelCase DTOs of
 * @nexus/shared. Dates leave the API as ISO-8601 strings.
 */
import type {
  ActorDto,
  ApiKeyDto,
  AppDto,
  EndpointStatsDto,
  GeoDto,
  HttpMethod,
  RequestSampleDto,
  StatusCountDto,
  TimeseriesPointDto,
} from '@nexus/shared';

import { userKeyToHex } from '../enrichment/user-key.hasher';
import { percentOf, roundOrNull, roundTo } from './numbers';
import type {
  ApiKeyRow,
  ApiRequestRow,
  AppRow,
  EndpointStatsRow,
  StatusCountRow,
  TrafficBucketRow,
} from './rows';
import type { Viewer } from './viewer';

/** WHY: nullable timestamp columns map to `string | null` in every DTO. */
function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * WHY: the Apps page lists keys without ever exposing a secret. `key_hash` is NEVER copied; the
 * full key only exists in `publicKey` for publishable keys (they ship in bundles anyway).
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
export function mapApiKey(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    kind: row.kind,
    keyPrefix: row.key_prefix,
    label: row.label,
    publicKey: row.kind === 'publishable' ? row.public_key : null,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    expiresAt: isoOrNull(row.expires_at),
    lastUsedAt: isoOrNull(row.last_used_at),
    lastSdk: row.last_sdk,
    exposedAt: isoOrNull(row.exposed_at),
    revokedAt: isoOrNull(row.revoked_at),
  };
}

/**
 * WHY: an app is shown by its public slug (the internal uuid never leaves the API) together with
 * its keys. `keys` must already belong to this app — grouping is the caller's job.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
export function mapApp(row: AppRow, keys: ApiKeyRow[]): AppDto {
  return {
    slug: row.slug,
    displayName: row.display_name,
    basePath: row.base_path,
    allowedOrigins: [...row.allowed_origins],
    isActive: row.is_active,
    browserIngestEnabled: row.browser_ingest_enabled,
    createdAt: row.created_at.toISOString(),
    keys: keys.map(mapApiKey),
  };
}

// ─── Analytics (read side) ──────────────────────────────────────────────────

/**
 * WHY: `method` is TEXT in SQL but CHECK-constrained to HTTP_METHOD_VALUES
 * (migrations/0004_api_requests.sql), so the narrowing cast is safe.
 */
function asHttpMethod(method: string): HttpMethod {
  return method as HttpMethod;
}

/**
 * WHY: one chart bucket. `pageViews` comes from web_events and is merged by the service
 * (OverviewService.timeseries); API-only charts leave it at 0.
 */
export function mapTimeseriesPoint(row: TrafficBucketRow, pageViews = 0): TimeseriesPointDto {
  return {
    bucket: row.bucket.toISOString(),
    requests: row.requests,
    errors4xx: row.errors_4xx,
    errors5xx: row.errors_5xx,
    p95Ms: roundOrNull(row.p95_ms),
    pageViews,
  };
}

/**
 * WHY: one API Routes table row. The error rate is derived here (not in SQL) so the list, the
 * detail header and the Errors page agree to the decimal; `calls` is >= 1 for any grouped row.
 * @see ../../migrations/0004_api_requests.sql
 */
export function mapEndpointStats(row: EndpointStatsRow): EndpointStatsDto {
  return {
    endpointId: row.endpoint_id,
    app: row.app_slug,
    method: asHttpMethod(row.method),
    routeTemplate: row.route_template,
    calls: row.calls,
    errors4xx: row.errors_4xx,
    errors5xx: row.errors_5xx,
    errorRate: percentOf(row.errors_4xx + row.errors_5xx, row.calls) ?? 0,
    p50Ms: roundOrNull(row.p50_ms),
    p95Ms: roundOrNull(row.p95_ms),
    p99Ms: roundOrNull(row.p99_ms),
    avgMs: roundOrNull(row.avg_ms),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

export function mapStatusCount(row: StatusCountRow): StatusCountDto {
  return { status: row.status_code, count: row.count };
}

/** WHY: an all-null location is "unknown", rendered as one dash rather than three. */
function mapGeo(
  row: Pick<ApiRequestRow, 'geo_country' | 'geo_region' | 'geo_city'>,
): GeoDto | null {
  if (row.geo_country === null && row.geo_region === null && row.geo_city === null) return null;
  return { country: row.geo_country, region: row.geo_region, city: row.geo_city };
}

/**
 * WHY: WHO made a request, shaped for the viewer. The IP is shown to ADMINS ONLY (ADR 0001,
 * "IP / PII"); every other viewer gets `ip: null`. `user_key` leaves the API as 64-char hex — the
 * opaque id used in Users URLs (never the email).
 */
export function mapActor(row: ApiRequestRow, viewer: Viewer): ActorDto {
  return {
    userKey: userKeyToHex(row.user_key),
    userEmail: row.user_email,
    claimedEmail: row.claimed_email,
    identitySource: row.identity_source,
    ip: viewer.isAdmin ? row.ip : null,
    geo: mapGeo(row),
  };
}

/**
 * WHY: one stored backend request (failed-request list, slowest calls) — role-masked via mapActor.
 * The wire field is `status`, the column `status_code` (ADR 0001).
 * @see ../../migrations/0004_api_requests.sql
 */
export function mapRequestSample(row: ApiRequestRow, viewer: Viewer): RequestSampleDto {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at.toISOString(),
    app: row.app_slug,
    kind: row.kind,
    method: asHttpMethod(row.method),
    path: row.path,
    routeTemplate: row.route_template,
    endpointId: row.endpoint_id,
    status: row.status_code,
    durationMs: roundTo(row.duration_ms),
    errorCode: row.error_code,
    requestId: row.request_id,
    actor: mapActor(row, viewer),
  };
}
