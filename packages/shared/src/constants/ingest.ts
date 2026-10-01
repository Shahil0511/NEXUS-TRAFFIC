/**
 * Ingest contract constants (contract v1).
 *
 * WHY: the public ingest contract other teams implement. Limits here are mirrored by the zod
 * schemas (`ingest/schemas.ts`), the DB CHECK constraints and the published guide
 * (docs/integration/02-server-contract.md, 03-browser-contract.md). Changing a limit is a
 * contract change — record it in docs/CHANGELOG.md. Additive only within v1; breaking → /v2.
 *
 * ZERO dependencies: this file is bundled into the reference SDKs.
 */

export const INGEST_CONTRACT_VERSION = 1;

export const INGEST_LIMITS = {
  server: { maxEvents: 500, maxBodyBytes: 512 * 1024 },
  browser: { maxEvents: 50, maxBodyBytes: 60 * 1024 },
  /** Longest accepted request duration (1 hour). */
  maxDurationMs: 3_600_000,
  /** Longest accepted visible-time delta for one `page_time` event (24 hours). */
  maxVisibleMs: 86_400_000,
  /** Raw path accepted on the wire; the server strips query/fragment and stores ≤ maxStoredPathLength. */
  maxWirePathLength: 2048,
  maxStoredPathLength: 512,
  maxRouteTemplateLength: 256,
  maxEmailLength: 254,
  maxUserAgentWireLength: 4096,
  maxUserAgentStoredLength: 512,
  maxRequestIdLength: 128,
  maxErrorCodeLength: 64,
  maxReleaseLength: 64,
  maxToolLength: 64,
  maxLabelLength: 120,
  maxReferrerHostLength: 253,
  maxPropsKeys: 10,
  maxPropStringLength: 128,
  maxSdkNameLength: 64,
  maxSdkVersionLength: 32,
} as const;

/**
 * Event-time acceptance window, relative to when the collector received the batch.
 * Events outside it are rejected per event with EVENT_TIME_OUT_OF_RANGE — never clamped,
 * because `occurred_at` is part of the idempotency key and must stay identical across retries.
 */
export const EVENT_CLOCK_POLICY = {
  maxBackdateMs: 7 * 24 * 60 * 60 * 1000,
  maxFutureMs: 5 * 60 * 1000,
} as const;

/** HTTP headers of the ingest + dashboard protocol. Lower-case them when reading from Node. */
export const INGEST_HEADERS = {
  key: 'X-Nexus-Key',
  session: 'X-Nexus-Session',
  pageView: 'X-Nexus-Page-View',
  user: 'X-Nexus-User',
  dashboard: 'X-Nexus-Dashboard',
  sdk: 'X-Nexus-SDK',
  contract: 'X-Nexus-Contract',
  requestId: 'X-Request-ID',
} as const;

/** `tool` and `custom.name` identifiers: lower-case, dotted, e.g. `audits.export-csv`. */
export const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

/** App error codes accepted on server events (codes only — NEVER messages). */
export const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

/** Keys allowed in `props` on tool_use / custom events. */
export const PROP_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** App slug, e.g. `ebo-sales`. Also the DB CHECK on apps.slug. */
export const APP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Requests the reference server SDK skips by default (noise). */
export const DEFAULT_SKIP_PATH_SUFFIXES = [
  '/health',
  '/healthz',
  '/ready',
  '/live',
  '/metrics',
  '/favicon.ico',
] as const;

export const DEFAULT_SKIP_EXTENSIONS = [
  '.js',
  '.mjs',
  '.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
] as const;

/** Reference SDK batching defaults (documented in docs/integration/04-responses-retries.md). */
export const SDK_DEFAULTS = {
  server: { flushEvents: 100, flushIntervalMs: 5000, maxQueue: 5000, requestTimeoutMs: 5000 },
  browser: { flushEvents: 20, flushIntervalMs: 5000, maxQueue: 200, sessionIdleMs: 30 * 60 * 1000 },
  retry: { maxAttempts: 3, baseDelayMs: 1000, jitterRatio: 0.2, authPauseMs: 5 * 60 * 1000 },
} as const;
