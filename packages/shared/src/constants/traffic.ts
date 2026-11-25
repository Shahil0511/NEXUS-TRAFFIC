/**
 * Enumerations of the traffic data model.
 *
 * WHY THIS FILE EXISTS
 * Every value here is ALSO enforced by a database CHECK constraint (apps/api/migrations/*.sql)
 * and validated by the ingest zod schemas. The `*_VALUES` arrays are the single source; the
 * parity test in apps/api (`schema-parity.integration.test.ts`) fails the build if a CHECK list
 * ever drifts from these arrays. NEVER add a value here without a migration that widens the CHECK.
 */
import { SDK_DEFAULTS } from './ingest';

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

// ─── Person access log (0013) ───────────────────────────────────────────────

/**
 * WHY: which person-level read an admin opened. One value per person-level read leaf
 * (ROUTES.users.profile / timeline / devices / daily, PERSON_ROUTE_LEAVES), plus one per list
 * narrowed to one person by `?userKey=` (PERSON_FILTERED_ROUTE_LEAVES): `person_visits` = the
 * sessions list, `person_failures` = the failed-request summary and list. ADR 0017 adds
 * `person_day` (one IST day of the Daily activity tab, ROUTES.users.day), `person_pattern` (usual
 * activity hours, ROUTES.users.pattern) and
 * `person_visit_steps` (the steps of ONE visit of a verified person, ROUTES.journeys.session,
 * admin-only once the visit has a user_key). Stored in
 * `traffic.person_access_log.surface` and mirrored by `person_access_log_surface_check` (0013,
 * widened by 0014).
 */
export const PERSON_ACCESS_SURFACE_VALUES = [
  'person_profile',
  'person_timeline',
  'person_devices',
  'person_daily',
  'person_visits',
  'person_failures',
  'person_day',
  'person_pattern',
  'person_visit_steps',
] as const;
export type PersonAccessSurface = (typeof PERSON_ACCESS_SURFACE_VALUES)[number];

/**
 * WHY: one page open fires several requests (tabs, refetches, "Load more"). The same admin +
 * person + surface is recorded at most once per this window, so the log reads as "who opened
 * whose page", not as a request log.
 */
export const PERSON_ACCESS_COALESCE_MS = 10 * 60 * 1000;

// ─── Person daily activity (ADR 0017) ───────────────────────────────────────

/**
 * WHY: ROUTES.users.daily returns one (IST day, app) row per app used that day. Safety cap on those
 * rows: 94 days × the registered apps stays far below it. When it is hit, the oldest (possibly
 * partial) day is dropped rather than shown with apps missing.
 */
export const USER_DAILY_APP_ROWS_LIMIT = 3000;

/**
 * WHY: a `page_time` delta normally covers one flush tick (~5 s). A much longer one means the tick
 * timer did not run (a sleeping laptop, a frozen tab), so the delta is not time the page was seen.
 * Every read that sums `visible_ms` credits at most 12 ticks per row (`creditedVisibleMs`,
 * apps/api/src/db/sql.ts); the stored value is unchanged. @see ADR 0017
 */
export const VISIBLE_DELTA_CREDIT_CAP_MS = 12 * SDK_DEFAULTS.browser.flushIntervalMs; // 60_000

/**
 * WHY: the one-day view (ROUTES.users.day) joins browser events into activity blocks: a break
 * shorter than this between two events keeps them in one block, a longer one starts a new block.
 * Block lengths are shown per block, never summed. @see ADR 0017
 */
export const USER_DAY_BLOCK_GAP_MS = 5 * 60_000;
/** Safety cap on the blocks of one day: 96 = one every 15 min of a whole day. */
export const USER_DAY_BLOCKS_LIMIT = 96;
/** Pages of one day, in first-view order; the rest is a "+N more" count. */
export const USER_DAY_PAGES_LIMIT = 30;
/** Features (tools) of one day, in first-use order; the rest is a "+N more" count. */
export const USER_DAY_TOOLS_LIMIT = 30;
/** Visits of one day, newest first (as on the Visits page, which continues the list). */
export const USER_DAY_VISITS_LIMIT = 50;
/**
 * How far back the one-day view goes, in IST days before today. WHY: the default raw retention is
 * about 6 months, so an older day is empty anyway; the API refuses it with a 400.
 */
export const USER_DAY_LOOKBACK_DAYS = 183;
