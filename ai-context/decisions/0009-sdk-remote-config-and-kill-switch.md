# ADR 0009 — SDK remote config, the kill switch and readable browser errors

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
- **Context:** once a browser tracker ships inside another team's bundle, Nexus had no way to make
  it capture less (a noisy module, a PII leak) without that team redeploying. The existing
  `apps.browser_ingest_enabled` refused events at ingest, but a cross-origin tracker could not even
  read the refusal: CORS headers were only set after key auth, so every `4xx` looked like a network
  error. And the per-IP failure limiter counted every `401`/`403`, so a killed app's old trackers
  behind one office NAT would have `429`-ed browser ingest for every app from that IP.
- **Decision:**
  1. **Transport** `ROUTES.ingest.config` = `POST /v1/ingest/config`, `text/plain` body
     `{key, client?}` (`sdkConfigRequestSchema`): a CORS simple request (no preflight), and the key
     never appears in a URL or an access log. Response `SdkRemoteConfig` `{contract: 1, version,
     enabled: true, disabledModules, maxAgeMs}` with `Cache-Control: no-store` (`NO_STORE_CACHE`,
     `apps/api/src/http/cache-control.ts`). `enabled` is reserved; a 200 always carries `true`.
  2. **Chain** = the browser chain with three differences: the pre-auth CORS step is first, a
     SEPARATE rate limiter instance `browserConfigRateLimit` (same per-minute budget, no-op
     `onLimited`, so polls never eat the ingest budget or inflate `ingest_counters.rate_limited`),
     and no session limiter and no rejection recorder. The route authenticates with the same SDK
     label the tracker sends at ingest, so `last_sdk` stays meaningful.
  3. **Storage** `apps.sdk_config_version` (≥ 1, optimistic), `sdk_disabled_modules`
     (`SDK_CAPTURE_MODULE_VALUES`), `sdk_config_updated_at`
     (`apps/api/migrations/0009_app_sdk_config.sql`). They ride `AppKeyCache` (30 s) — the config
     route adds zero queries; `toSdkRemoteConfig` (`apps/api/src/domain/sdk-config.ts`) maps the row.
  4. **Remote config can only DISABLE** modules (`page_view`, `page_time`, `auto_tools`,
     `manual_tools`, `custom`, `header_propagation`, `retry_queue`); it never enables anything and
     never turns propagation on. Module switches need SDK ≥ `SDK_MODULE_SWITCH_MIN_VERSION` (1.1.0).
  5. **Kill switch = the existing `apps.browser_ingest_enabled`** — already audited, already
     enforced at ingest for every SDK version including 1.0.0. When it is off (or the app is off, or
     the key is bad) the config route answers `401`/`403` through `publishableKeyAuth`; the SDK
     treats `SDK_KILL_ERROR_CODES` (`APP_DISABLED`, `BROWSER_INGEST_DISABLED`, `INVALID_API_KEY`,
     `WRONG_KEY_TYPE`, `SECRET_KEY_EXPOSED`) as "disable everything", also on ingest responses.
  6. **Admin:** `ROUTES.apps.updateSdkConfig` = `PATCH /v1/apps/:slug/sdk-config`
     `{expectedVersion, disabledModules}`; a version mismatch is `409 CONFLICT`; audited as
     `APP_SDK_CONFIG_UPDATE` (`{slug, version, disabledModules}`), stored in canonical module order;
     `AppKeyCache.invalidateApp` after commit. The Apps page dialog shows the kill switch as
     "Kill switch (browser capture)" and saves it before the module list.
  7. **SDK behaviour (fail open, honour a known kill):** apply the cached config for the key scope
     synchronously when it is younger than `configMaxStaleMs` (24 h), else the defaults; fetch only
     when older than `configMaxAgeMs` (5 min), with the captured native fetch, `credentials:'omit'`,
     a 3 s timeout, never blocking the host. A valid 200 with `version ≥ cached` is applied; an
     invalid body is ignored; a kill code caches `{enabled:false}`, rechecks after
     `disabledRecheckMs` (15 min) and runs `applyDisabled()` **in the current page**. While killed,
     each started tracker keeps ONE slow timer (every `disabledRecheckMs`) that re-asks the config;
     a valid 200 for a killed scope LIFTS the kill in the same page (`applyEnabledForScope`: the
     scope leaves `disabledKeys`, trackers re-attach and send the suppressed page view, the early
     patches are re-installed). The abort timer covers the response BODY, and a refresh settles
     within twice `configTimeoutMs` whatever the network does, so the retry-queue drain chained on
     it always runs; network errors,
     opaque responses, `5xx` and `429` keep the state. An **in-page polling floor** (`nextAttemptAt`)
     allows one attempt per `maxAgeMs` per page whatever the outcome, so blocked storage or repeated
     errors can never turn into a request per flush tick. The key scope is
     `publishableKey.trim().slice(0, 14)`.
  8. **Readable errors (pre-auth CORS):** `browserIngestEarlyCorsMiddleware(origins)`
     (`apps/api/src/http/middleware/browser-ingest-cors.middleware.ts`) is mounted FIRST on POST
     `ingest.browser` and `ingest.config`: `Vary: Origin`, and when the `registered`-rule
     `AllowedOriginCache` allows the origin (ANY registered app lists it, whatever its `is_active` /
     `browser_ingest_enabled` — looser than the preflight, because the kill switch IS
     `browser_ingest_enabled = false` and a killed app's own origin must still read its `403`) it
     reflects the Origin, sets
     `Access-Control-Allow-Credentials: true` and exposes `X-Nexus-Contract, Retry-After`. A cache or
     DB failure means "not allowed" (no headers), never a failed request. The stricter per-app
     `browserIngestCors` stays after auth, unchanged, and success still needs `originGuard`.
  9. **`AllowedOriginCache`** (`apps/api/src/auth/allowed-origin.cache.ts`): LRU, 500 entries, 30 s
     TTL, negatives cached, origins lower-cased without a trailing slash, **one in-flight lookup per
     origin** (concurrent misses share it; a failed lookup is not cached). Two instances
     (`container.ts`): rule `browser-enabled` over `AppRepository.anyAllowsOrigin` (active +
     browser-enabled apps) serves the preflight; rule `registered` over `AppRepository.anyListsOrigin`
     (any app) serves the early CORS. Beacons add no query.
  10. **IP failure limiter rule:** a response counts as a failure only when its status is
      `401`/`403` AND `res.locals.errorCode ∈ IP_FAILURE_ERROR_CODES` — the key guesses
      (`KEY_GUESS_ERROR_CODES`: `MISSING_API_KEY`, `INVALID_API_KEY`, `WRONG_KEY_TYPE`) plus
      `ORIGIN_NOT_ALLOWED` — `isCountedIpFailure` in
      `apps/api/src/http/middleware/rate-limit.middleware.ts`; `errorHandlerMiddleware` sets
      `res.locals.errorCode` before sending. The kill codes (`APP_DISABLED`,
      `BROWSER_INGEST_DISABLED`, `SECRET_KEY_EXPOSED`) are never counted. `ORIGIN_NOT_ALLOWED` IS
      counted (amended in the final Phase A review): a publishable key is public, `originGuard`
      refuses a forged or missing Origin before the key and session limiters run, and each refusal
      writes an `ingest_rejections` row — without the IP limiter that path had no bound at all.
      Trade-off: the page origin of a misconfigured app (not registered) behind one office NAT can
      `429` browser ingest from that IP until the origin is registered.
- **Consequences:**
  - A kill takes effect within the cache lag (≤ 30 s server side) for new requests, and in the
    current page as soon as the tracker sees a kill code. Old 1.0.0 trackers keep sending and keep
    being refused at ingest.
  - Origins registered for *any* app can read error bodies of the browser endpoints. They contain
    codes and generic messages only, so nothing about another app leaks.
  - `AppDto.sdkConfig` is visible to every dashboard viewer (`apps.list`); it is not secret.
