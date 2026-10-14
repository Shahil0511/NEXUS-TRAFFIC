/**
 * Row types exactly as SELECTed from PostgreSQL (snake_case). Mappers in ./mappers.ts turn them
 * into camelCase DTOs from @nexus/shared. Keep in sync with apps/api/migrations/*.sql.
 */
import type {
  AuditAction,
  IdentitySource,
  IngestSource,
  IpClass,
  KeyKind,
  ServerEventKind,
  TimelineItemKind,
} from '@nexus/shared';

/** @see ../../migrations/0002_apps_and_api_keys.sql */
export interface AppRow {
  id: string;
  slug: string;
  display_name: string;
  base_path: string | null;
  allowed_origins: string[];
  is_active: boolean;
  browser_ingest_enabled: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/** @see ../../migrations/0002_apps_and_api_keys.sql */
export interface ApiKeyRow {
  id: string;
  app_id: string;
  kind: KeyKind;
  key_prefix: string;
  key_hash: Buffer;
  public_key: string | null;
  label: string;
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  last_sdk: string | null;
  exposed_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
}

/** @see ../../migrations/0003_admin_audit_log.sql */
export interface AdminAuditRow {
  id: number;
  created_at: Date;
  actor_email: string;
  action: AuditAction;
  target_type: string;
  target_id: string;
  details: Record<string, unknown> | null;
}

/** @see ../../migrations/0004_api_requests.sql — the columns list endpoints SELECT. */
export interface ApiRequestRow {
  occurred_at: Date;
  /** occurred_at as µs-precision ISO text (`keysetTimeExpr`), the keyset cursor position. */
  occurred_at_key: string;
  event_id: string;
  app_slug: string;
  endpoint_id: string;
  kind: ServerEventKind;
  method: string;
  route_template: string;
  path: string;
  status_code: number;
  duration_ms: number;
  error_code: string | null;
  request_id: string | null;
  session_id: string | null;
  user_email: string | null;
  user_key: Buffer | null;
  claimed_email: string | null;
  identity_source: IdentitySource;
  ip: string | null;
  ip_class: IpClass;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
}

/** @see ../../migrations/0006_ingest_counters.sql */
export interface IngestCounterRow {
  app_id: string;
  source: IngestSource;
  bucket_hour: Date;
  accepted: number;
  duplicates: number;
  rejected: number;
  rate_limited: number;
}

// ─── Analytics query rows (read side, aggregates) ───────────────────────────
// int8 counts and float8/numeric aggregates arrive as JS numbers (type parsers in src/db/pool.ts).

/** @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeTraffic */
export interface TrafficSummaryRow {
  requests: number;
  /** Requests with status_code >= 400. */
  errors: number;
  /** p95 of duration_ms over kind = 'http' only; null when there is no http row. */
  p95_ms: number | null;
}

/**
 * The API-call half of one app's row on the Applications page.
 * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeTrafficByApp
 */
export interface AppTrafficRow extends TrafficSummaryRow {
  app_id: string;
  last_event_at: Date | null;
}

/**
 * The browser + people half of one app's row on the Applications page.
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.summarizeActivityByApp
 */
export interface AppActivityRow {
  app_id: string;
  /** Distinct verified users over api_requests ∪ web_events. */
  users: number;
  page_views: number;
  /** Distinct browser sessions. */
  sessions: number;
  tool_uses: number;
  last_event_at: Date | null;
}

/**
 * One chart bucket.
 * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.timeseries
 */
export interface TrafficBucketRow {
  bucket: Date;
  requests: number;
  errors_4xx: number;
  errors_5xx: number;
  p95_ms: number | null;
}

/**
 * One (endpoint, app, method, route template).
 * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listEndpointStats
 */
export interface EndpointStatsRow {
  endpoint_id: string;
  app_slug: string;
  method: string;
  route_template: string;
  calls: number;
  errors_4xx: number;
  errors_5xx: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
  last_seen_at: Date;
}

/** @see ../repositories/api-request-query.repository.ts */
export interface StatusCountRow {
  status_code: number;
  count: number;
}

/** @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeErrors */
export interface ErrorTotalsRow {
  total: number;
  errors_4xx: number;
  errors_5xx: number;
}

/** Everything the endpoint detail page needs (null from the repository when there are no rows). */
export interface EndpointDetailRows {
  stats: EndpointStatsRow;
  timeseries: TrafficBucketRow[];
  statusBreakdown: StatusCountRow[];
  slowest: ApiRequestRow[];
}

/** Everything the Errors page summary needs. */
export interface ErrorSummaryRows {
  totals: ErrorTotalsRow;
  byStatus: StatusCountRow[];
  timeseries: TrafficBucketRow[];
  topEndpoints: EndpointStatsRow[];
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.pageViewTimeseries */
export interface PageViewBucketRow {
  bucket: Date;
  page_views: number;
}

// ─── Browser analytics rows (S3: Users, Journeys, Pages & Tools, Geography) ──

/**
 * One verified user (user_key IS NOT NULL ⇔ sso_cookie / app_attested) over BOTH tables.
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUsers
 */
export interface UserSummaryRow {
  user_key: Buffer;
  user_email: string;
  first_seen_at: Date;
  last_seen_at: Date;
  requests: number;
  failed_requests: number;
  page_views: number;
  sessions: number;
  /** App slugs, sorted. */
  apps: string[];
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserProfile */
export interface UserToolCountRow {
  app_slug: string;
  tool: string;
  uses: number;
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserProfile */
export interface UserPageCountRow {
  app_slug: string;
  path_template: string;
  views: number;
}

/** Everything the user profile needs (null from the repository when the user has no rows). */
export interface UserProfileRows {
  summary: UserSummaryRow;
  topTools: UserToolCountRow[];
  topPages: UserPageCountRow[];
  /** ISO-3166 alpha-2 codes, most frequent first. */
  countries: string[];
}

/**
 * One API call or browser event of a user, merged by time (`page_time` folded into `visible_ms`).
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserTimeline
 */
export interface TimelineEventRow {
  occurred_at: Date;
  /** occurred_at as µs-precision ISO text (`keysetTimeExpr`), the keyset cursor position. */
  occurred_at_key: string;
  event_id: string;
  kind: TimelineItemKind;
  app_slug: string;
  path: string;
  session_id: string | null;
  identity_source: IdentitySource;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  tool: string | null;
  visible_ms: number | null;
  name: string | null;
  /** `api` rows only. */
  endpoint_id: string | null;
  ip: string | null;
}

/**
 * One (app, session_id) of browser events.
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listSessions
 */
export interface SessionSummaryRow {
  app_slug: string;
  session_id: string;
  started_at: Date;
  last_seen_at: Date;
  duration_ms: number;
  page_views: number;
  tool_uses: number;
  visible_ms: number;
  user_key: Buffer | null;
  user_email: string | null;
  claimed_email: string | null;
  /** The STRONGEST identity source seen in the session (IDENTITY_SOURCE_VALUES order). */
  identity_source: IdentitySource;
  entry_path: string | null;
  exit_path: string | null;
  country: string | null;
  ip: string | null;
}

/**
 * One step of a session replay: a browser event (`seq` set) or a correlated API call (`seq` null).
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getSession
 */
export interface SessionEventRow {
  event_id: string;
  occurred_at: Date;
  seq: number | null;
  kind: TimelineItemKind;
  path: string;
  tool: string | null;
  visible_ms: number | null;
  name: string | null;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  /** `api` rows only. */
  endpoint_id: string | null;
}

/** Everything the session replay needs (null from the repository when the session has no rows). */
export interface SessionRows {
  summary: SessionSummaryRow;
  /** Ordered by (seq, occurred_at, event_id). */
  browserEvents: SessionEventRow[];
  /** Ordered by (occurred_at, event_id). */
  apiCalls: SessionEventRow[];
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listTopPaths */
export interface TopPathRow {
  app_slug: string;
  step1: string;
  step2: string;
  step3: string;
  sessions: number;
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listPageStats */
export interface PageStatsRow {
  app_slug: string;
  path_template: string;
  views: number;
  unique_sessions: number;
  avg_visible_ms: number | null;
  p50_visible_ms: number | null;
  exits: number;
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listToolUsage */
export interface ToolUsageRow {
  /** Internal id — only used to match trend rows, never mapped into a DTO. */
  app_id: string;
  app_slug: string;
  tool: string;
  uses: number;
  distinct_users: number;
  distinct_sessions: number;
  last_used_at: Date;
}

/** Uses of one tool per IST-aligned bucket (only buckets with rows; gaps filled later). */
export interface ToolTrendRow {
  app_id: string;
  tool: string;
  bucket: Date;
  uses: number;
}

/** The top tools and the per-bucket trend of exactly those tools. */
export interface ToolUsageRows {
  tools: ToolUsageRow[];
  trend: ToolTrendRow[];
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listCountries */
export interface GeoCountryRow {
  country: string | null;
  requests: number;
  page_views: number;
  users: number;
}

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listCities */
export interface GeoCityRow {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  requests: number;
  page_views: number;
  users: number;
}

// ─── Live (S4) ──────────────────────────────────────────────────────────────

/** @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.activityTimeseries */
export interface ActivityBucketRow {
  bucket: Date;
  page_views: number;
  tool_uses: number;
}

/**
 * One API call or browser event (page_time excluded) of the Live backfill, newest first.
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listRecentEvents
 */
export interface LiveEventRow {
  occurred_at: Date;
  event_id: string;
  kind: TimelineItemKind;
  app_slug: string;
  path: string;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  tool: string | null;
  user_email: string | null;
  user_key: Buffer | null;
  /** `api` rows only. */
  endpoint_id: string | null;
  session_id: string | null;
  ip: string | null;
  geo_country: string | null;
  geo_city: string | null;
}

// ─── Integration Health (S5) ────────────────────────────────────────────────

/**
 * Every registered app with the newest stored event of each source (all retained partitions).
 * @see ../repositories/ingest-health.repository.ts IngestHealthRepository.perApp
 */
export interface AppHealthRow {
  app_id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
  last_server_at: Date | null;
  last_browser_at: Date | null;
}

/** Σ of `traffic.ingest_counters` per app and source over the health window. */
export interface IngestCounterSumRow {
  app_id: string;
  source: IngestSource;
  accepted: number;
  duplicates: number;
  rejected: number;
  rate_limited: number;
}

/**
 * Events of one (app, source, sdk) in the health window, with clock skew and — server only — how
 * many carried a private/loopback IP out of those with a classified IP (browser rows: 0 / 0).
 */
export interface SdkHealthRow {
  app_id: string;
  source: IngestSource;
  sdk: string | null;
  events: number;
  last_seen_at: Date;
  median_skew_ms: number | null;
  max_abs_skew_ms: number | null;
  private_ip_events: number;
  classified_ip_events: number;
}

/** A secret key flagged by the browser endpoint that still authenticates (not revoked/expired). */
export interface ExposedKeyRow {
  app_id: string;
  id: string;
  key_prefix: string;
  label: string;
  exposed_at: Date;
}

/** @see ../repositories/ingest-health.repository.ts IngestHealthRepository.perApp */
export interface IngestHealthRows {
  apps: AppHealthRow[];
  counters: IngestCounterSumRow[];
  sdks: SdkHealthRow[];
  exposedKeys: ExposedKeyRow[];
}
