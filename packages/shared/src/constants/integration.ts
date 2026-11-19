/**
 * Integration Health rules (ROUTES.integration.health → the dashboard's Integration page).
 *
 * WHY: the API decides the status and the warnings of each app, the dashboard explains them and
 * links the guide chapter that fixes them — both read the SAME codes and thresholds from here, so a
 * warning can never be computed one way and described another. The thresholds are also quoted by
 * the public guide (docs/integration/06-client-ip.md, 10-verify.md).
 *
 * ZERO dependencies (shared barrel).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Counters, SDK versions, clock skew and the private-IP ratio cover this trailing window. */
export const INTEGRATION_HEALTH_WINDOW_MS = 24 * HOUR;

/** An app whose newest event (either source) is older than this is `stale`. */
export const INTEGRATION_STALE_AFTER_MS = 24 * HOUR;

/** Share of server events with a private/loopback IP above which we hint "set trustProxyHops". */
export const PRIVATE_IP_RATIO_THRESHOLD = 0.9;

/** Fewer classified server events than this → no private-IP verdict (too little data). */
export const PRIVATE_IP_MIN_EVENTS = 20;

/** |median clock skew| of one SDK above this → "fix the sender's clock (NTP)". */
export const CLOCK_SKEW_WARN_MS = MINUTE;

/**
 * Overall wiring status of an app, from its newest stored event of either source:
 * - healthy: an event within INTEGRATION_STALE_AFTER_MS
 * - stale:   events exist, but none that recent
 * - never:   no event at all in the retained data
 */
export const INTEGRATION_STATUS_VALUES = ['healthy', 'stale', 'never'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS_VALUES)[number];

/**
 * What the Integration page flags, most urgent first (the API returns them in this order).
 * - exposed_key:     an unrevoked, unexpired SECRET key was sent to the browser endpoint → rotate it
 * - pii_detected:    the ingest PII scrubber redacted personal data in the window (ADR 0010) → fix the sender
 * - app_disabled:    the app is switched off; every event is refused (APP_DISABLED)
 * - never_received:  no event yet → follow the verify chapter
 * - stale:           nothing recent → is the middleware still mounted / NEXUS_URL set?
 * - private_ips:     > PRIVATE_IP_RATIO_THRESHOLD of server events carry private IPs → trustProxyHops
 * - clock_skew:      an SDK's median skew exceeds CLOCK_SKEW_WARN_MS → NTP
 * - rejected_events: events were rejected in the window → see `rejected[].code` in the 202 answer
 * - rate_limited:    batches were refused with 429 in the window → batch more, send less often
 */
export const INTEGRATION_WARNING_VALUES = [
  'exposed_key',
  'pii_detected',
  'app_disabled',
  'never_received',
  'stale',
  'private_ips',
  'clock_skew',
  'rejected_events',
  'rate_limited',
] as const;
export type IntegrationWarning = (typeof INTEGRATION_WARNING_VALUES)[number];

// ─── Coverage KPIs and the integration level (ADR 0013) ─────────────────────

/** WHY: below this many events a coverage ratio is null — too little data for a verdict. */
export const COVERAGE_MIN_EVENTS = 20;

/** WHY: linking and browser-identity ratios at or above this count towards `complete`. */
export const COVERAGE_TARGET_RATIO = 0.8;

/** WHY: share of events carrying `release` (per source) needed for `complete`. */
export const RELEASE_COVERAGE_TARGET = 0.95;

/**
 * How far an app's integration has got, computed by the API from status, sources and coverage:
 * - not_connected: status `never` (no event at all)
 * - partial:       status `stale`, or only one source has events
 * - connected:     both sources have events
 * - complete:      connected AND linking ≥ COVERAGE_TARGET_RATIO AND browser identity ≥
 *                  COVERAGE_TARGET_RATIO AND every source's release ratio ≥ RELEASE_COVERAGE_TARGET
 *                  AND none of exposed_key / pii_detected / app_disabled (a null ratio is not complete)
 */
export const INTEGRATION_LEVEL_VALUES = ['not_connected', 'partial', 'connected', 'complete'] as const;
export type IntegrationLevel = (typeof INTEGRATION_LEVEL_VALUES)[number];

/**
 * WHY: the hourly diagnostic tables (ingest_rejections, pii_detections, sso_cookie_outcomes) are
 * pruned after this many days by the retention job; raw events keep their own retention.
 */
export const AGGREGATE_RETENTION_DAYS = 90;

/** WHY: Integration Health lists at most this many rejection reasons per app (busiest first). */
export const MAX_REJECTION_ROWS_PER_APP = 20;
