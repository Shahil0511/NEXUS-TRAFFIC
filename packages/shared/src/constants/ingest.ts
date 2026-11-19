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
  /** Envelope `environment` on the wire — lenient on purpose (ADR 0008); stored values are ENVIRONMENT_VALUES. */
  maxEnvironmentWireLength: 32,
  /** Browser `client.tz` / `client.lang` (also the CHECKs of web_events.client_tz / client_lang, 0007). */
  maxClientTzLength: 64,
  maxClientLangLength: 16,
  /** Normalised zod issue path stored in traffic.ingest_rejections.schema_path (0010). */
  maxSchemaPathLength: 128,
} as const;

/**
 * WHY: an IANA zone name like `Asia/Kolkata` or `America/Argentina/Buenos_Aires`. Values that do
 * not match are soft-dropped by the browser enricher (FIELD_DROPPED `client.tz`), never stored.
 */
export const CLIENT_TZ_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** WHY: a BCP-47-ish language tag like `en-IN`; others are soft-dropped (FIELD_DROPPED `client.lang`). */
export const CLIENT_LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

/**
 * WHY: one batch may contain many distinct invalid events; at most this many distinct
 * (code, schema_path) keys are recorded in traffic.ingest_rejections per batch, the rest are folded
 * into schema_path '' — a sender must not be able to create unbounded rows.
 */
export const REJECTION_MAX_DISTINCT_PER_BATCH = 20;

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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Leaf values of SDK_DEFAULTS.browser that the pre-hydration `@nexus/react/early` entry reads.
 * WHY separate exports: a bundler keeps a whole object literal once any field is used, so the
 * early entry imports these leaves instead of SDK_DEFAULTS (its size budget, ADR 0011).
 * SDK_DEFAULTS.browser references them, so there is still ONE source of truth.
 */
export const SDK_BROWSER_SESSION_IDLE_MS = 30 * MINUTE_MS;
export const SDK_BROWSER_CONFIG_MAX_STALE_MS = 24 * HOUR_MS;
export const SDK_BROWSER_XHR_PATCH: boolean = true;

/** Reference SDK batching defaults (documented in docs/integration/04-responses-retries.md). */
export const SDK_DEFAULTS = {
  server: { flushEvents: 100, flushIntervalMs: 5000, maxQueue: 5000, requestTimeoutMs: 5000 },
  browser: {
    flushEvents: 20,
    flushIntervalMs: 5000,
    maxQueue: 200,
    /**
     * Serialised batches waiting in the in-page sender (one in flight). Beyond this the oldest
     * waiting batch is handed to the retry queue (or dropped), so a dead collector never grows memory.
     */
    maxPendingBatches: 10,
    /** A live ingest fetch that has not answered by then is aborted (→ retried like a network error). */
    ingestTimeoutMs: 15_000,
    sessionIdleMs: SDK_BROWSER_SESSION_IDLE_MS,
    // ─── retry queue (ADR 0012) ───
    /** Persisted batches per key scope (localStorage), oldest dropped first. */
    retryQueueMaxBatches: 20,
    /** Bytes per key scope — small, because host apps share the origin's storage quota. */
    retryQueueMaxBytes: 128 * 1024,
    /** A persisted batch older than this (by its oldest occurredAt) is dropped, never replayed. */
    retryQueueTtlMs: 24 * HOUR_MS,
    /** A batch replayed on this many page loads without delivery is dropped (no poison loop). */
    retryQueueMaxReplays: 3,
    // ─── remote config (ADR 0009) ───
    /** Fetch POST ROUTES.ingest.config only when the cached config is older than this. */
    configMaxAgeMs: 5 * MINUTE_MS,
    /** A cached config older than this is ignored at start (code defaults apply). */
    configMaxStaleMs: SDK_BROWSER_CONFIG_MAX_STALE_MS,
    configTimeoutMs: 3000,
    /** After a kill code, re-ask the server this often. */
    disabledRecheckMs: 15 * MINUTE_MS,
    // ─── header propagation (ADR 0011) ───
    /** Also decorate XMLHttpRequest (axios) with the session headers. */
    xhrPatch: SDK_BROWSER_XHR_PATCH,
  },
  retry: { maxAttempts: 3, baseDelayMs: 1000, jitterRatio: 0.2, authPauseMs: 5 * 60 * 1000 },
} as const;
