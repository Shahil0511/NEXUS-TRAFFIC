/**
 * Row → DTO mappers: the ONLY place snake_case PostgreSQL rows become the camelCase DTOs of
 * @nexus/shared. Dates leave the API as ISO-8601 strings.
 */
import type {
  ActorDto,
  ApiKeyDto,
  AppDto,
  AppTrafficDto,
  BreakdownItemDto,
  EndpointStatsDto,
  EnvironmentMixDto,
  ErrorCodeCountDto,
  ExposedKeyDto,
  GeoCityDto,
  GeoCountryDto,
  GeoDto,
  HttpMethod,
  IngestCounterDto,
  LiveEventDto,
  OnlineAppDto,
  OnlineUserDto,
  PageStatsDto,
  PersonAccessEntryDto,
  PiiDetectionDto,
  RejectionReasonDto,
  RequestSampleDto,
  SdkConfigDto,
  SdkHealthDto,
  SessionEventDto,
  SessionSummaryDto,
  SsoCookieOutcomeDto,
  StatusCountDto,
  TimelineItemDto,
  TimeseriesPointDto,
  ToolTrendPointDto,
  ToolUsageDto,
  TimeWindowDto,
  TopPathDto,
  UserActivityBlockDto,
  UserAppUsageDto,
  UserDayActivityDto,
  UserDayAppActivityDto,
  UserDayDetailDto,
  UserDayPageDto,
  UserDayToolDto,
  UserDayVisitDto,
  UserDeviceDto,
  UserEndpointUsageDto,
  UserLatestContextDto,
  UserProfileDto,
  UserSummaryDto,
  UserUsageDto,
} from '@nexus/shared';
import { RANGE_DURATIONS_MS } from '@nexus/shared';
import { toPageId, toToolId } from '@nexus/shared/endpoint-id';

import { userKeyToHex } from '../enrichment/user-key.hasher';
import { computeMetric } from './compute-deltas';
import type { ApiRequestInsert, WebEventInsert } from './inserts';
import { percentOf, roundOrNull, roundTo } from './numbers';
import type {
  ApiKeyRow,
  ApiRequestRow,
  AppActivityRow,
  AppRow,
  AppTrafficRow,
  BreakdownRow,
  EndpointStatsRow,
  EnvironmentMixRow,
  ErrorCodeCountRow,
  ExposedKeyRow,
  GeoCityRow,
  GeoCountryRow,
  IngestCounterSumRow,
  LiveEventRow,
  OnlineAppRow,
  OnlineUserRow,
  PageStatsRow,
  PersonAccessLogRow,
  PiiDetectionRow,
  RejectionReasonRow,
  SdkHealthRow,
  SessionEventRow,
  SessionSummaryRow,
  SsoCookieOutcomeRow,
  StatusCountRow,
  TimelineEventRow,
  ToolTrendRow,
  ToolUsageRow,
  TopPathRow,
  TrafficBucketRow,
  UserActivityBlockRow,
  UserAppRow,
  UserDayAppActivityRow,
  UserDayPageRow,
  UserDayRows,
  UserDayToolRow,
  UserDeviceRow,
  UserEndpointRow,
  UserLatestContextRow,
  UserProfileRows,
  UserSummaryRow,
  UserUsageRow,
} from './rows';
import type { Viewer } from './viewer';

/** WHY: nullable timestamp columns map to `string | null` in every DTO. */
function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * WHY: the hourly diagnostic tables store '' for "none / unknown" (a NULL cannot be part of their
 * primary key); the DTOs say null, so the dashboard has one "unknown" to render.
 */
function nullIfEmpty(value: string): string | null {
  return value === '' ? null : value;
}

/** Decimals of 0..1 shares and ratios (0.12345 → 0.1235). */
const SHARE_DECIMALS = 4;
/** One IST calendar day (India has no DST). */
const REPORTING_DAY_MS = RANGE_DURATIONS_MS.today;

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
    sdkConfig: mapSdkConfig(row),
    createdAt: row.created_at.toISOString(),
    keys: keys.map(mapApiKey),
  };
}

/**
 * WHY: the browser SDK's remote config as the admin sees it (ADR 0009); `version` is what
 * ROUTES.apps.updateSdkConfig expects back as `expectedVersion`.
 * @see ../../migrations/0009_app_sdk_config.sql
 */
export function mapSdkConfig(row: AppRow): SdkConfigDto {
  return {
    version: row.sdk_config_version,
    disabledModules: [...row.sdk_disabled_modules],
    updatedAt: isoOrNull(row.sdk_config_updated_at),
  };
}

// ─── Analytics (read side) ──────────────────────────────────────────────────

/**
 * WHY: `method` is TEXT in SQL but CHECK-constrained to HTTP_METHOD_VALUES
 * (migrations/0004_api_requests.sql), so the narrowing cast is safe.
 */
export function asHttpMethod(method: string): HttpMethod {
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

/**
 * WHY: one "Error codes" row of the Errors page. The code is the CHECK-constrained app code
 * (ERROR_CODE_PATTERN — never a message); NULL stays null = "sent without a code".
 * @see ../../migrations/0004_api_requests.sql
 */
export function mapErrorCodeCount(row: ErrorCodeCountRow): ErrorCodeCountDto {
  return { errorCode: row.error_code, count: row.count, routes: row.routes };
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
    sessionId: row.session_id,
    actor: mapActor(row, viewer),
  };
}

/** The four per-app rows behind one Applications row (absent = no events in that window). */
export interface AppTrafficSources {
  traffic: AppTrafficRow | undefined;
  previousTraffic: AppTrafficRow | undefined;
  activity: AppActivityRow | undefined;
  previousActivity: AppActivityRow | undefined;
}

/** Newest of two nullable timestamps. */
function latestOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * WHY: one row of the Applications page. An app with no events in a window counts as zeros, so
 * a silent integration shows up as 0 instead of disappearing.
 */
export function mapAppTraffic(app: AppRow, sources: AppTrafficSources): AppTrafficDto {
  const { traffic, previousTraffic, activity, previousActivity } = sources;
  return {
    app: app.slug,
    displayName: app.display_name,
    requests: computeMetric(traffic?.requests ?? 0, previousTraffic?.requests ?? 0),
    errorRate: computeMetric(
      percentOf(traffic?.errors ?? 0, traffic?.requests ?? 0),
      percentOf(previousTraffic?.errors ?? 0, previousTraffic?.requests ?? 0),
    ),
    p95Ms: roundOrNull(traffic?.p95_ms ?? null),
    pageViews: computeMetric(activity?.page_views ?? 0, previousActivity?.page_views ?? 0),
    users: computeMetric(activity?.users ?? 0, previousActivity?.users ?? 0),
    sessions: activity?.sessions ?? 0,
    toolUses: activity?.tool_uses ?? 0,
    lastEventAt: latestOf(traffic?.last_event_at, activity?.last_event_at)?.toISOString() ?? null,
    identifiedPct: activity ? percentOf(activity.identified, activity.events) : null,
    // Denominator = LINKABLE calls only (ADR 0013): SSR, bots and streams can never link.
    linkedPct: traffic ? percentOf(traffic.linked, traffic.linkable) : null,
  };
}

/**
 * WHY: one value of a breakdown; `share` (0..1) is over ALL events of the window (`total`), not
 * just the listed top values, so the shares of a truncated list add up to less than 1.
 */
export function mapBreakdownItem(row: BreakdownRow): BreakdownItemDto {
  return {
    value: row.value,
    events: row.events,
    share: row.total === 0 ? 0 : roundTo(row.events / row.total, SHARE_DECIMALS),
  };
}

/**
 * WHY: one verified user's count (callers of a route, viewers of a page, users of a tool, users hit
 * by failures). `user_key` leaves as hex — the opaque id of the user's page.
 */
export function mapUserUsage(row: UserUsageRow): UserUsageDto {
  return {
    userKey: row.user_key.toString('hex'),
    email: row.user_email,
    count: row.count,
    lastSeenAt: row.last_seen_at.toISOString(),
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
    failedRequests: row.failed_requests,
    firstSeenAt: row.first_seen_at.toISOString(),
    apps: [...row.apps],
  };
}

/** WHY: one route of a user's profile, linked by its stored endpoint_id. */
export function mapUserEndpoint(row: UserEndpointRow): UserEndpointUsageDto {
  return {
    endpointId: row.endpoint_id,
    app: row.app_slug,
    method: asHttpMethod(row.method),
    routeTemplate: row.route_template,
    calls: row.calls,
    failed: row.failed,
  };
}

/** WHY: one app of a user's profile ("Apps used"). */
export function mapUserApp(row: UserAppRow): UserAppUsageDto {
  return {
    app: row.app_slug,
    requests: row.requests,
    pageViews: row.page_views,
    toolUses: row.tool_uses,
    sessions: row.sessions,
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

/**
 * WHY: the profile header + its top lists, from the rows of getUserProfile and the user's top
 * routes. Pages and tools carry their opaque ids (toPageId / toToolId) so they can be links.
 */
export function mapUserProfile(
  rows: UserProfileRows,
  topEndpoints: readonly UserEndpointRow[],
  latest: UserLatestContextRow | null,
): UserProfileDto {
  return {
    summary: mapUserSummary(rows.summary),
    firstSeenAt: rows.summary.first_seen_at.toISOString(),
    failedRequests: rows.summary.failed_requests,
    topTools: rows.topTools.map((row) => ({
      toolId: toToolId(row.app_slug, row.tool),
      app: row.app_slug,
      tool: row.tool,
      uses: row.uses,
    })),
    topPages: rows.topPages.map((row) => ({
      pageId: toPageId(row.app_slug, row.path_template),
      app: row.app_slug,
      pathTemplate: row.path_template,
      views: row.views,
    })),
    topEndpoints: topEndpoints.map(mapUserEndpoint),
    perApp: rows.perApp.map(mapUserApp),
    countries: [...rows.countries],
    latest: latest ? mapUserLatestContext(latest) : null,
  };
}

/** WHY: one device (device type, browser, OS) a user was seen on ("Devices" tab). */
export function mapUserDevice(row: UserDeviceRow): UserDeviceDto {
  return {
    device: row.device,
    browser: row.browser,
    os: row.os,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    pageViews: row.page_views,
    requests: row.requests,
    visits: row.visits,
    apps: [...row.apps],
  };
}

/** WHY: the "latest known" facts of a user's identity card, from ONE browser event. */
export function mapUserLatestContext(row: UserLatestContextRow): UserLatestContextDto {
  return {
    seenAt: row.seen_at.toISOString(),
    app: row.app_slug,
    device: row.ua_device,
    browser: row.ua_browser,
    os: row.ua_os,
    timeZone: row.client_tz,
    language: row.client_lang,
    appVersion: row.release,
  };
}

/** WHY: one app on one IST day of a user's activity (a `perApp` line of the "Daily activity" tab). */
export function mapUserDayAppActivity(row: UserDayAppActivityRow): UserDayAppActivityDto {
  return {
    app: row.app,
    firstActivityAt: row.first_activity_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
    activeMs: row.active_ms,
    pageViews: row.page_views,
    requests: row.requests,
    failedRequests: row.failed_requests,
    toolUses: row.tool_uses,
    visits: row.visits,
  };
}

/**
 * WHY: the daily read asks for one row more than `limit` (newest day first). When that extra row
 * came back, the OLDEST day in the answer may be missing some of its apps, so that whole day group
 * is dropped: a day is shown complete or not at all. At most `limit` rows remain.
 */
export function dropTruncatedOldestDay(
  rows: readonly UserDayAppActivityRow[],
  limit: number,
): UserDayAppActivityRow[] {
  if (rows.length <= limit) return [...rows];
  const oldest = rows[rows.length - 1]?.day.getTime();
  return rows.filter((row) => row.day.getTime() !== oldest).slice(0, limit);
}

/**
 * WHY: folds the (day, app) rows of the daily read into one item per IST day, keeping the SQL
 * order (newest day first; within a day, apps by first activity). The day's counts and tab visible
 * time are the Σ of its apps, first / last activity their min / max, `apps` the sorted slugs. A
 * visit is (app, session), so Σ of per-app visits is the day's visits. `now` decides whether the
 * day is still running (`inProgress`: its last activity is only "so far").
 */
export function foldUserDays(
  rows: readonly UserDayAppActivityRow[],
  now: Date,
): UserDayActivityDto[] {
  const groups: { day: Date; rows: UserDayAppActivityRow[] }[] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current !== undefined && current.day.getTime() === row.day.getTime()) {
      current.rows.push(row);
    } else {
      groups.push({ day: row.day, rows: [row] });
    }
  }
  return groups.map((group) => foldUserDay(group.day, group.rows, now));
}

/** WHY: one day of foldUserDays — the non-empty app rows of ONE day, in SQL order. */
function foldUserDay(
  day: Date,
  rows: readonly UserDayAppActivityRow[],
  now: Date,
): UserDayActivityDto {
  const perApp = rows.map(mapUserDayAppActivity);
  const sum = (pick: (app: UserDayAppActivityDto) => number): number =>
    perApp.reduce((total, app) => total + pick(app), 0);
  const first = Math.min(...rows.map((row) => row.first_activity_at.getTime()));
  const last = Math.max(...rows.map((row) => row.last_activity_at.getTime()));
  return {
    day: day.toISOString(),
    firstActivityAt: new Date(first).toISOString(),
    lastActivityAt: new Date(last).toISOString(),
    activeMs: sum((app) => app.activeMs),
    pageViews: sum((app) => app.pageViews),
    requests: sum((app) => app.requests),
    failedRequests: sum((app) => app.failedRequests),
    toolUses: sum((app) => app.toolUses),
    visits: sum((app) => app.visits),
    apps: perApp.map((app) => app.app).sort(),
    inProgress: day.getTime() + REPORTING_DAY_MS > now.getTime(),
    perApp,
  };
}

// ─── One person-day (ROUTES.users.day) ──────────────────────────────────────

/** WHY: one activity block of the one-day view; its span is end − start (shown, never summed). */
export function mapUserActivityBlock(row: UserActivityBlockRow): UserActivityBlockDto {
  return {
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    spanMs: row.end_at.getTime() - row.start_at.getTime(),
    timeInAppMs: row.time_in_app_ms,
    activeMs: row.active_ms,
    apps: row.apps,
    pageViews: row.page_views,
    toolUses: row.tool_uses,
    requests: row.requests,
  };
}

/** WHY: one page of the day; the detail link uses the opaque pageId, never the template. */
export function mapUserDayPage(row: UserDayPageRow): UserDayPageDto {
  return {
    pageId: toPageId(row.app_slug, row.path_template),
    app: row.app_slug,
    pathTemplate: row.path_template,
    firstViewAt: isoOrNull(row.first_view_at),
    views: row.views,
    activeMs: row.active_ms,
  };
}

/** WHY: one feature of the day; the detail link uses the opaque toolId. */
export function mapUserDayTool(row: UserDayToolRow): UserDayToolDto {
  return {
    toolId: toToolId(row.app_slug, row.tool),
    app: row.app_slug,
    tool: row.tool,
    firstUseAt: row.first_use_at.toISOString(),
    uses: row.uses,
  };
}

/**
 * WHY: one visit of the day. Only the visit's own facts: the session row also carries the email,
 * the claimed email, the country and the IP, and NONE of them is copied (the page names the
 * person already).
 */
export function mapUserDayVisit(row: SessionSummaryRow): UserDayVisitDto {
  return {
    app: row.app_slug,
    sessionId: row.session_id,
    startedAt: row.started_at.toISOString(),
    lastActivityAt: row.last_seen_at.toISOString(),
    entryPath: row.entry_path,
    exitPath: row.exit_path,
    pageViews: row.page_views,
    toolUses: row.tool_uses,
    activeMs: row.visible_ms,
  };
}

/**
 * WHY: the one-day view from its reads. The day summary is the daily fold of the day's (day, app)
 * rows (null = no activity). The block rows carry the day totals over ALL blocks (window
 * functions before the LIMIT), so time in app and the calls outside blocks are true for the whole
 * day even when the blocks are cut: `blockCount` is the day's block count before the LIMIT and
 * `blocksTruncated` = the day has more blocks than returned.
 * Calls outside blocks = the day's calls − the calls inside blocks, never below 0 (a call landing
 * between the two reads cannot make it negative). Lists without rows give 0 totals.
 */
export function mapUserDayDetail(
  rows: UserDayRows,
  window: TimeWindowDto,
  day: string,
  now: Date,
): UserDayDetailDto {
  const summary = foldUserDays(rows.days, now)[0] ?? null;
  const firstBlock = rows.blocks[0];
  const requestsInBlocks = firstBlock?.requests_in_blocks ?? 0;
  const blockCount = firstBlock?.block_count ?? 0;
  return {
    window,
    day,
    summary,
    timeInAppMs: firstBlock?.day_time_in_app_ms ?? 0,
    blocks: rows.blocks.map(mapUserActivityBlock),
    blockCount,
    blocksTruncated: blockCount > rows.blocks.length,
    requestsOutsideBlocks: Math.max(0, (summary?.requests ?? 0) - requestsInBlocks),
    pages: rows.pages.map(mapUserDayPage),
    pagesTotal: rows.pages[0]?.total ?? 0,
    tools: rows.tools.map(mapUserDayTool),
    toolsTotal: rows.tools[0]?.total ?? 0,
    visits: rows.visits.map(mapUserDayVisit),
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
    endpointId: row.endpoint_id,
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
    endpointId: row.endpoint_id,
  };
}

export function mapTopPath(row: TopPathRow): TopPathDto {
  return { app: row.app_slug, steps: [row.step1, row.step2, row.step3], sessions: row.sessions };
}

/** WHY: time on page — avg/p50 are rounded to whole milliseconds (visible time is integral). */
export function mapPageStats(row: PageStatsRow): PageStatsDto {
  return {
    pageId: toPageId(row.app_slug, row.path_template),
    app: row.app_slug,
    pathTemplate: row.path_template,
    views: row.views,
    uniqueSessions: row.unique_sessions,
    distinctUsers: row.distinct_users,
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
    toolId: toToolId(row.app_slug, row.tool),
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
    userKey: userKeyToHex(row.user_key),
    endpointId: row.endpoint_id,
    sessionId: row.session_id,
    ip: ipFor(row.ip, viewer),
    country: row.geo_country,
    city: row.geo_city,
  };
}

/**
 * WHY: "who is online" is shown to EVERY dashboard viewer, so the row carries no IP and the DTO
 * has none — nothing to mask. user_key leaves as 64-char hex (the user page's address).
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listOnlineUsers
 */
export function mapOnlineUser(row: OnlineUserRow): OnlineUserDto {
  return {
    userKey: row.user_key.toString('hex'),
    email: row.user_email,
    app: row.app_slug,
    sessionId: row.session_id,
    currentPage: row.current_page,
    lastEvent: {
      kind: row.kind,
      path: row.path,
      tool: row.tool,
      method: row.method,
      status: row.status_code,
      endpointId: row.endpoint_id,
    },
    lastSeenAt: row.last_seen_at.toISOString(),
    events: row.events,
  };
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countOnlineByApp */
export function mapOnlineApp(row: OnlineAppRow): OnlineAppDto {
  return { app: row.app_slug, users: row.users, anonymous: row.anonymous };
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
    userKey: userKeyToHex(row.userKey),
    endpointId: row.endpointId,
    sessionId: row.sessionId,
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
    userKey: userKeyToHex(row.userKey),
    endpointId: null,
    sessionId: row.sessionId,
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

/**
 * `@nexus/express@1.1.0` → name `@nexus/express`, version `1.1.0`: split at the LAST '@' when it
 * is not the first character (scoped names start with '@'). Anything else is unsplittable.
 */
export function splitSdkLabel(sdk: string | null): { name: string | null; version: string | null } {
  const at = sdk === null ? -1 : sdk.lastIndexOf('@');
  if (sdk === null || at <= 0 || at === sdk.length - 1) return { name: null, version: null };
  return { name: sdk.slice(0, at), version: sdk.slice(at + 1) };
}

/** WHY: one SDK seen on one source; skew in whole ms (sub-ms precision is noise). */
export function mapSdkHealth(row: SdkHealthRow): SdkHealthDto {
  return {
    source: row.source,
    sdk: row.sdk,
    ...splitSdkLabel(row.sdk),
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

/** WHY: Integration Health is NOT env-filtered — it shows the mix so staging wiring is visible. */
export function mapEnvironmentMix(row: EnvironmentMixRow): EnvironmentMixDto {
  return { source: row.source, environment: row.environment, events: row.events };
}

/**
 * WHY: a rejection reason is a CODE and a normalised schema path — never a zod message or a value.
 * @see ../../migrations/0010_ingest_rejections.sql
 */
export function mapRejectionReason(row: RejectionReasonRow): RejectionReasonDto {
  return {
    source: row.source,
    sdk: nullIfEmpty(row.sdk),
    code: row.code,
    schemaPath: nullIfEmpty(row.schema_path),
    rejected: row.rejected,
  };
}

/** WHY: counts only — the redacted value was never stored. @see ../../migrations/0011_pii_detections.sql */
export function mapPiiDetection(row: PiiDetectionRow): PiiDetectionDto {
  return { source: row.source, field: row.field, kind: row.kind, detections: row.detections };
}

/** @see ../../migrations/0012_sso_cookie_outcomes.sql */
export function mapSsoCookieOutcome(row: SsoCookieOutcomeRow): SsoCookieOutcomeDto {
  return { outcome: row.outcome, beaconOrigin: row.beacon_origin, beacons: row.beacons };
}

/**
 * WHY: the access log names the person by the MASKED email stored at write time (never the full
 * address); the hex user_key opens their page.
 * @see ../../migrations/0013_person_access_log.sql
 * @see ../../migrations/0014_person_access_surfaces_day_pattern_visit_steps.sql (surface CHECK widened)
 */
export function mapPersonAccessEntry(row: PersonAccessLogRow): PersonAccessEntryDto {
  return {
    id: row.id,
    viewedAt: row.viewed_at.toISOString(),
    viewerEmail: row.viewer_email,
    subjectUserKey: row.subject_user_key.toString('hex'),
    subjectEmailMasked: row.subject_email_masked,
    surface: row.surface,
  };
}
