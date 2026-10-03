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
  'app_disabled',
  'never_received',
  'stale',
  'private_ips',
  'clock_skew',
  'rejected_events',
  'rate_limited',
] as const;
export type IntegrationWarning = (typeof INTEGRATION_WARNING_VALUES)[number];
