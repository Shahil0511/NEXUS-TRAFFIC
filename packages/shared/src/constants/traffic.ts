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

// ─── Admin audit ────────────────────────────────────────────────────────────

export const AUDIT_ACTION_VALUES = [
  'APP_CREATE',
  'APP_UPDATE',
  'APP_DISABLE',
  'KEY_CREATE',
  'KEY_EXPIRE',
  'KEY_REVOKE',
] as const;
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number];
