/**
 * Row → DTO mappers: the ONLY place snake_case PostgreSQL rows become the camelCase DTOs of
 * @nexus/shared. Dates leave the API as ISO-8601 strings.
 */
import type {
  ActorDto,
  ApiKeyDto,
  AppDto,
  EndpointStatsDto,
  ExposedKeyDto,
  GeoCityDto,
  GeoCountryDto,
  GeoDto,
  HttpMethod,
  IngestCounterDto,
  LiveEventDto,
  PageStatsDto,
  RequestSampleDto,
  SdkHealthDto,
  SessionEventDto,
  SessionSummaryDto,
  StatusCountDto,
  TimelineItemDto,
  TimeseriesPointDto,
  ToolTrendPointDto,
  ToolUsageDto,
  TopPathDto,
  UserProfileDto,
  UserSummaryDto,
} from '@nexus/shared';

import { userKeyToHex } from '../enrichment/user-key.hasher';
import type { ApiRequestInsert, WebEventInsert } from './inserts';
import { percentOf, roundOrNull, roundTo } from './numbers';
import type {
  ApiKeyRow,
  ApiRequestRow,
  AppRow,
  EndpointStatsRow,
  ExposedKeyRow,
  GeoCityRow,
  GeoCountryRow,
  IngestCounterSumRow,
  LiveEventRow,
  PageStatsRow,
  SdkHealthRow,
  SessionEventRow,
  SessionSummaryRow,
  StatusCountRow,
  TimelineEventRow,
  ToolTrendRow,
  ToolUsageRow,
  TopPathRow,
  TrafficBucketRow,
  UserProfileRows,
  UserSummaryRow,
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

// ─── Browser analytics (S3: Users, Journeys, Pages & Tools, Geography) ──────

/** WHY: the IP leaves the API for ADMINS ONLY (ADR 0001, "IP / PII"). */
function ipFor(ip: string | null, viewer: Viewer): string | null {
  return viewer.isAdmin ? ip : null;
}

/**
 * WHY: one row of the Users table. `user_key` leaves the API as 64-char hex — the opaque id used
 * in Users URLs. ONLY verified identities reach this mapper (user_key IS NOT NULL in SQL).
 * @see ../../migrations/0005_web_events.sql
 */
export function mapUserSummary(row: UserSummaryRow): UserSummaryDto {
  return {
    userKey: row.user_key.toString('hex'),
    email: row.user_email,
    lastSeenAt: row.last_seen_at.toISOString(),
    requests: row.requests,
    pageViews: row.page_views,
    sessions: row.sessions,
    apps: [...row.apps],
  };
}

/** WHY: the profile header + its top lists, from the rows of getUserProfile. */
export function mapUserProfile(rows: UserProfileRows): UserProfileDto {
  return {
    summary: mapUserSummary(rows.summary),
    firstSeenAt: rows.summary.first_seen_at.toISOString(),
    failedRequests: rows.summary.failed_requests,
    topTools: rows.topTools.map((row) => ({ app: row.app_slug, tool: row.tool, uses: row.uses })),
    topPages: rows.topPages.map((row) => ({
      app: row.app_slug,
      pathTemplate: row.path_template,
      views: row.views,
    })),
    countries: [...rows.countries],
  };
}

/**
 * WHY: one item of a user's combined timeline (API call or browser event), role-masked: the IP
 * is shown to admins only.
 */
export function mapTimelineItem(row: TimelineEventRow, viewer: Viewer): TimelineItemDto {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at.toISOString(),
    kind: row.kind,
    app: row.app_slug,
    path: row.path,
    sessionId: row.session_id,
    identitySource: row.identity_source,
    method: row.method,
    status: row.status_code,
    durationMs: roundOrNull(row.duration_ms),
    tool: row.tool,
    visibleMs: row.visible_ms,
    name: row.name,
    ip: ipFor(row.ip, viewer),
  };
}

/** WHY: one Journeys session row, role-masked (first IP of the session for admins only). */
export function mapSessionSummary(row: SessionSummaryRow, viewer: Viewer): SessionSummaryDto {
  return {
    app: row.app_slug,
    sessionId: row.session_id,
    startedAt: row.started_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    durationMs: Math.round(row.duration_ms),
    pageViews: row.page_views,
    toolUses: row.tool_uses,
    visibleMs: row.visible_ms,
    userKey: userKeyToHex(row.user_key),
    userEmail: row.user_email,
    claimedEmail: row.claimed_email,
    identitySource: row.identity_source,
    entryPath: row.entry_path,
    exitPath: row.exit_path,
    country: row.country,
    ip: ipFor(row.ip, viewer),
  };
}

/** WHY: one replay step (browser event or correlated API call). Carries no IP or identity. */
export function mapSessionEvent(row: SessionEventRow): SessionEventDto {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at.toISOString(),
    seq: row.seq,
    kind: row.kind,
    path: row.path,
    tool: row.tool,
    visibleMs: row.visible_ms,
    name: row.name,
    method: row.method,
    status: row.status_code,
    durationMs: roundOrNull(row.duration_ms),
  };
}

export function mapTopPath(row: TopPathRow): TopPathDto {
  return { app: row.app_slug, steps: [row.step1, row.step2, row.step3], sessions: row.sessions };
}

/** WHY: time on page — avg/p50 are rounded to whole milliseconds (visible time is integral). */
export function mapPageStats(row: PageStatsRow): PageStatsDto {
  return {
    app: row.app_slug,
    pathTemplate: row.path_template,
    views: row.views,
    uniqueSessions: row.unique_sessions,
    avgVisibleMs: roundOrNull(row.avg_visible_ms, 0),
    p50VisibleMs: roundOrNull(row.p50_visible_ms, 0),
    exits: row.exits,
  };
}

export function mapToolTrendPoint(row: ToolTrendRow): ToolTrendPointDto {
  return { bucket: row.bucket.toISOString(), uses: row.uses };
}

/**
 * WHY: one Tools table row. `trend` is already gap-filled by the service (ToolService.usage);
 * the internal `app_id` is NEVER copied.
 */
export function mapToolUsage(row: ToolUsageRow, trend: ToolTrendPointDto[]): ToolUsageDto {
  return {
    app: row.app_slug,
    tool: row.tool,
    uses: row.uses,
    distinctUsers: row.distinct_users,
    distinctSessions: row.distinct_sessions,
    lastUsedAt: row.last_used_at.toISOString(),
    trend,
  };
}

export function mapGeoCountry(row: GeoCountryRow): GeoCountryDto {
  return {
    country: row.country,
    requests: row.requests,
    pageViews: row.page_views,
    users: row.users,
  };
}

/** WHY: city centroids are approximate; 4 decimals (~11 m) is more than GeoLite2 knows. */
export function mapGeoCity(row: GeoCityRow): GeoCityDto {
  return {
    country: row.country,
    region: row.region,
    city: row.city,
    lat: roundOrNull(row.lat, 4),
    lon: roundOrNull(row.lon, 4),
    requests: row.requests,
    pageViews: row.page_views,
    users: row.users,
  };
}

// ─── Live (S4) ──────────────────────────────────────────────────────────────

/**
 * WHY: one row of the Live backfill (GET ROUTES.live.snapshot), role-masked: the IP is shown to
 * admins only. `userEmail` is the VERIFIED email (claims are never shown as identity).
 * @see ../../migrations/0004_api_requests.sql
 * @see ../../migrations/0005_web_events.sql
 */
export function mapLiveEvent(row: LiveEventRow, viewer: Viewer): LiveEventDto {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at.toISOString(),
    app: row.app_slug,
    kind: row.kind,
    path: row.path,
    method: row.method,
    status: row.status_code,
    durationMs: roundOrNull(row.duration_ms),
    tool: row.tool,
    userEmail: row.user_email,
    ip: ipFor(row.ip, viewer),
    country: row.geo_country,
    city: row.geo_city,
  };
}

/**
 * WHY: a just-committed API call as a Live event, in its ADMIN form (with the stored IP). The
 * broadcaster derives the viewer form with `withoutIp` — NEVER send this to a viewer room.
 */
export function liveEventOfApiRequest(appSlug: string, row: ApiRequestInsert): LiveEventDto {
  return {
    eventId: row.eventId,
    occurredAt: row.occurredAt.toISOString(),
    app: appSlug,
    kind: 'api',
    path: row.path,
    method: row.method,
    status: row.statusCode,
    durationMs: roundTo(row.durationMs),
    tool: null,
    userEmail: row.userEmail,
    ip: row.ip,
    country: row.geoCountry,
    city: row.geoCity,
  };
}

/** WHY: a just-committed browser event as a Live event, ADMIN form (see liveEventOfApiRequest). */
export function liveEventOfWebEvent(appSlug: string, row: WebEventInsert): LiveEventDto {
  return {
    eventId: row.eventId,
    occurredAt: row.occurredAt.toISOString(),
    app: appSlug,
    kind: row.eventType,
    path: row.path,
    method: null,
    status: null,
    durationMs: null,
    tool: row.tool,
    userEmail: row.userEmail,
    ip: row.ip,
    country: row.geoCountry,
    city: row.geoCity,
  };
}

/** WHY: the viewer form of a Live event — identical except that the IP is gone (ADR 0001). */
export function withoutIp(event: LiveEventDto): LiveEventDto {
  return { ...event, ip: null };
}

// ─── Integration Health (S5) ────────────────────────────────────────────────

/**
 * WHY: the window's counters of one source (the service adds a zero row for a source with none).
 * @see ../../migrations/0006_ingest_counters.sql
 */
export function mapIngestCounter(row: IngestCounterSumRow): IngestCounterDto {
  return {
    source: row.source,
    accepted: row.accepted,
    duplicates: row.duplicates,
    rejected: row.rejected,
    rateLimited: row.rate_limited,
  };
}

/** WHY: one SDK seen on one source; skew in whole ms (sub-ms precision is noise). */
export function mapSdkHealth(row: SdkHealthRow): SdkHealthDto {
  return {
    source: row.source,
    sdk: row.sdk,
    events: row.events,
    lastSeenAt: row.last_seen_at.toISOString(),
    medianClockSkewMs: roundOrNull(row.median_skew_ms, 0),
    maxAbsClockSkewMs: row.max_abs_skew_ms,
  };
}

/** WHY: an exposed secret is identified by its PREFIX only — the key itself is never stored in clear. */
export function mapExposedKey(row: ExposedKeyRow): ExposedKeyDto {
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    label: row.label,
    exposedAt: row.exposed_at.toISOString(),
  };
}
