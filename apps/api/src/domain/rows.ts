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
  identified_users: number;
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
