/**
 * Enumerations of the traffic data model.
 *
 * WHY THIS FILE EXISTS
 * Every value here is ALSO enforced by a database CHECK constraint (apps/api/migrations/*.sql)
 * and validated by the ingest zod schemas. The `*_VALUES` arrays are the single source; the
 * parity test in apps/api (`schema-parity.integration.test.ts`) fails the build if a CHECK list
 * ever drifts from these arrays. NEVER add a value here without a migration that widens the CHECK.
 */

// ─── Browser (frontend tracker) events ──────────────────────────────────────

/** What a browser tracker can send. `page_time` carries a DELTA of visible ms, summed per page view. */
export const BROWSER_EVENT_TYPE_VALUES = ['page_view', 'page_time', 'tool_use', 'custom'] as const;
export type BrowserEventType = (typeof BROWSER_EVENT_TYPE_VALUES)[number];

/** How the page was reached: a full document load or a client-side route change. */
export const NAV_TYPE_VALUES = ['load', 'route'] as const;
export type NavType = (typeof NAV_TYPE_VALUES)[number];

/** Why a `page_time` delta was flushed. */
export const PAGE_TIME_REASON_VALUES = ['hidden', 'route', 'pagehide', 'idle'] as const;
export type PageTimeReason = (typeof PAGE_TIME_REASON_VALUES)[number];

/** Optional verb for a `tool_use` event. */
export const TOOL_ACTION_VALUES = [
  'click',
  'open',
  'submit',
  'export',
  'toggle',
  'search',
  'other',
] as const;
export type ToolAction = (typeof TOOL_ACTION_VALUES)[number];

// ─── Server (backend middleware) events ─────────────────────────────────────

/** `stream` = SSE, downloads, CSV exports. Kept OUT of latency percentiles (they skew p95). */
export const SERVER_EVENT_KIND_VALUES = ['http', 'stream'] as const;
export type ServerEventKind = (typeof SERVER_EVENT_KIND_VALUES)[number];

export const HTTP_METHOD_VALUES = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type HttpMethod = (typeof HTTP_METHOD_VALUES)[number];

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * How trustworthy the user identity on an event is, strongest first.
 * - sso_cookie:     the collector itself verified the SSO `access_token` cookie (browser beacons).
 * - app_attested:   the app backend sent `userEmail`, authenticated by its SECRET key.
 * - client_claimed: a browser-side hint (`user.email`) — anyone with the public key can forge it.
 * - anonymous:      no identity.
 * ONLY the first two fill `user_email`; a claim is stored in `claimed_email` and never counts.
 */
export const IDENTITY_SOURCE_VALUES = [
  'sso_cookie',
  'app_attested',
  'client_claimed',
  'anonymous',
] as const;
export type IdentitySource = (typeof IDENTITY_SOURCE_VALUES)[number];

/** Sources that are trusted enough to populate `user_email` / `user_key`. */
export const IDENTIFIED_SOURCE_VALUES = ['sso_cookie', 'app_attested'] as const;

// ─── IP handling ────────────────────────────────────────────────────────────

export const IP_CLASS_VALUES = ['public', 'private', 'loopback', 'unknown'] as const;
export type IpClass = (typeof IP_CLASS_VALUES)[number];

/** Env `IP_STORAGE_MODE`. Geo is ALWAYS resolved from the full IP before this is applied. */
export const IP_STORAGE_MODE_VALUES = ['full', 'truncated', 'hashed'] as const;
export type IpStorageMode = (typeof IP_STORAGE_MODE_VALUES)[number];

// ─── Ingest bookkeeping ─────────────────────────────────────────────────────

export const INGEST_SOURCE_VALUES = ['server', 'browser'] as const;
export type IngestSource = (typeof INGEST_SOURCE_VALUES)[number];

// ─── Environment (ADR 0008) ─────────────────────────────────────────────────

/**
 * WHY: staging and local dev traffic must never pollute prod dashboards. Stored on every event row
 * (`environment`, CHECK in 0007). The wire field is LENIENT (any short string): the API maps an
 * unknown value to the default with a FIELD_DROPPED warning instead of rejecting the batch.
 */
export const ENVIRONMENT_VALUES = ['prod', 'staging', 'dev'] as const;
export type Environment = (typeof ENVIRONMENT_VALUES)[number];

/** WHY: what an event without a (valid) claim is stored as — also the column DEFAULT in 0007. */
export const DEFAULT_ENVIRONMENT: Environment = 'prod';

/**
 * WHY: the dashboard's `env` query filter. `all` disables the filter; an absent value means
 * DEFAULT_ENVIRONMENT (applied in the API, so existing query literals keep compiling).
 */
export const ENVIRONMENT_FILTER_VALUES = [...ENVIRONMENT_VALUES, 'all'] as const;
export type EnvironmentFilter = (typeof ENVIRONMENT_FILTER_VALUES)[number];

// ─── SDK remote config (ADR 0009) ───────────────────────────────────────────

/**
 * WHY: capture modules of the browser SDK that remote config (POST ROUTES.ingest.config) may
 * DISABLE — never enable. Mirrored by `apps_sdk_disabled_modules_check` (0009).
 */
export const SDK_CAPTURE_MODULE_VALUES = [
  'page_view',
  'page_time',
  'auto_tools',
  'manual_tools',
  'custom',
  'header_propagation',
  'retry_queue',
] as const;
export type SdkCaptureModule = (typeof SDK_CAPTURE_MODULE_VALUES)[number];

/**
 * WHY: the first browser SDK version that honours `disabledModules` from remote config (ADR 0009).
 * Older SDKs obey only the full kill switch, which ingest enforces for every version. A fixed fact,
 * so it does NOT move with later SDK version bumps.
 */
export const SDK_MODULE_SWITCH_MIN_VERSION = '1.1.0';

// ─── SSO cookie diagnostics (ADR 0013) ──────────────────────────────────────

/**
 * WHY: the outcome of verifying the SSO `access_token` cookie on one browser batch, counted per
 * hour in `traffic.sso_cookie_outcomes` (0012) so Integration Health can say WHY beacons are
 * anonymous. `ok` + every failure reason of `@nexus/auth` verifyAccessTokenCookie, plus
 * `no-email` (a valid cookie whose email is implausible).
 */
export const SSO_COOKIE_OUTCOME_VALUES = [
  'ok',
  'no-cookie',
  'no-secret',
  'malformed',
  'bad-alg',
  'bad-signature',
  'expired',
  'not-yet-valid',
  'wrong-type',
  'no-email',
] as const;
export type SsoCookieOutcome = (typeof SSO_COOKIE_OUTCOME_VALUES)[number];

/**
 * WHY: whether the beacon's Origin equals the collector's PUBLIC_ORIGIN — a cross-origin beacon
 * cannot carry the SSO cookie, which explains a `no-cookie` outcome.
 */
export const BEACON_ORIGIN_VALUES = ['same_origin', 'cross_origin', 'none'] as const;
export type BeaconOrigin = (typeof BEACON_ORIGIN_VALUES)[number];

/**
 * WHY: API calls from these device classes can carry the tracker's session headers — the
 * denominator of the linking KPI (SSR, bots and server-to-server calls can never link).
 * Mirrors apps/api/src/enrichment/user-agent.parser.ts DEVICE_CLASSES (browser-capable classes).
 */
export const LINKABLE_DEVICE_CLASSES = ['desktop', 'mobile', 'tablet'] as const;

// ─── Breakdowns (ROUTES.overview.breakdown) ─────────────────────────────────

/** WHY: the whitelisted GROUP BY dimensions of the breakdown endpoint (one SQL column each). */
export const BREAKDOWN_DIMENSION_VALUES = [
  'browser',
  'os',
  'device',
  'referrer_host',
  'nav',
  'time_reason',
  'client_tz',
  'client_lang',
  'release',
  'environment',
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSION_VALUES)[number];

/** WHY: the subset that `api_requests` has columns for (source=server). */
export const SERVER_BREAKDOWN_DIMENSION_VALUES = [
  'browser',
  'os',
  'device',
  'release',
  'environment',
] as const satisfies readonly BreakdownDimension[];
export type ServerBreakdownDimension = (typeof SERVER_BREAKDOWN_DIMENSION_VALUES)[number];

// ─── Admin audit ────────────────────────────────────────────────────────────

export const AUDIT_ACTION_VALUES = [
  'APP_CREATE',
  'APP_UPDATE',
  'APP_DISABLE',
  'KEY_CREATE',
  'KEY_EXPIRE',
  'KEY_REVOKE',
  /** Remote SDK config (module switches) changed — ROUTES.apps.updateSdkConfig (ADR 0009). */
  'APP_SDK_CONFIG_UPDATE',
] as const;
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number];
