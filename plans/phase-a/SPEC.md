# PHASE A — IMPLEMENTATION SPEC, FINAL ("data theek karna")

**Repos**
- Main repo: `D:\server\NEXUS TRAFFIC`.
- Reference app: `D:\server\EBO_SALES`.
  - It may be edited for the Nexus integration only.
  - Its changes stay UNCOMMITTED (ADR 0003 item 5).
- Every other app under `D:\server` is read-only.

**Sources**
- The seven area maps and three critiques.
- My own read-only checks of these files:
  - `packages/shared/src/{routes.ts, constants/*, errors.ts (zod-free, no imports), ingest/schemas.ts, schemas/common.ts, dto/integration.ts}`
  - `packages/auth/src/{index.ts, verify-access-token-cookie.ts}` (exports `CookieVerifyResult`, `VerifyFailureReason`)
  - `apps/api/src/http/routes/index.ts`, `http/middleware/{rate-limit, browser-ingest-cors}.middleware.ts`
  - `http/types/express.d.ts`, `services/partition.service.ts`, `jobs/retention.job.ts`
  - `apps/api/src/live/*` (there is no `live-feed.test.ts`)
  - `packages/node/src/snippets-payload.contract.test.ts:396-422` (a 3-column describe.each that requires `tools.length > 0`)
  - `apps/api/test/security/security.test.ts:109-138`
  - the migrations dir (0001–0006 exist; ADRs 0001–0007 exist)

---

## 0. Pre-flight (whoever runs Wave 1 does this first)

1. **Check the migration ledger.**
   - Run `npm run migrate:status -w @nexus/api` (read-only) against the local dev DB.
   - If it lists `0007_grants`, reset that dev DB with `npm run dev:reset -- --yes`.
   - Never skip numbers: `loader.test.ts` requires contiguous versions.
   - Production's ledger is 0001–0006, so 0007 is free there.
2. **Start Docker Desktop.** DB tests run only on a throwaway container:
   `docker run -d --rm --name nexus-testdb-phasea -e POSTGRES_PASSWORD=testpw -p 127.0.0.1:55432:5432 postgres:18-alpine`
   Never use the dev container: the bootstrap rewrites the cluster-wide nexus_app password.
3. **Build before testing.** Package tests import dist, so every `npm test` needs `npm run build:shared && npm run build -w @nexus/node` first.
4. **Commit cadence (CLAUDE.md rule 5).**
   - Nothing is committed until the FINAL gate is green.
   - Then the lead makes EXACTLY ONE commit in `D:\server\NEXUS TRAFFIC`. It contains all waves, the PROGRESS entry, the ai-context updates and the ADRs.
   - The commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - No commit in EBO_SALES.

---

## 1. Decisions and defaults (one-line rationale each)

### Environment (A4) → ADR 0008 `0008-environment-dimension.md`
Supersedes the ADR 0001 row "No environment dimension". `<slug>-dev` apps remain allowed.

- **Values:** `ENVIRONMENT_VALUES = ['prod','staging','dev']`. Short, and exactly what the owner asked for.
- **Wire field:** optional `environment` on BOTH envelopes.
  - It is a LENIENT `z.string().min(1).max(INGEST_LIMITS.maxEnvironmentWireLength=32)`, not a `z.enum`. A typo must never 400 a whole batch, and a browser 400 happens before auth, so it cannot be attributed.
  - The API checks the value against `ENVIRONMENT_VALUES`.
  - An unknown value becomes `FIELD_DROPPED` (field `environment`) on the first stored event, following the existing envelope-warning precedent, and is then treated as absent.
- **Stored:** `environment text NOT NULL DEFAULT 'prod'` plus a CHECK, on `api_requests` and `web_events`.
  - The constant default is metadata-only.
  - History stays visible under the default prod filter.
  - Old code can still insert, so rollback is safe.
- **Not an ActorColumn.** Environment is a separate insert field, so the 16-column actor parity test stays unchanged.
- **Resolution:** `resolveEnvironment` in `apps/api/src/domain/environment.ts`.
  - **Browser:** if the request Origin host is loopback, the result is `'dev'` whatever the claim. Origin comes from the existing `requestOrigin`, and falls back to Referer when Origin is absent. Loopback means `localhost`, `*.localhost`, `*.local`, `127.0.0.0/8` or `[::1]`. This keeps localhost dev beacons, including the admin@libas.in dev-cookie traffic, out of prod.
  - Otherwise, the valid claim if there is one, else `'prod'`.
  - **Server:** the valid claim, else `'prod'`. There is NO IP heuristic, because a misconfigured proxy can make prod IPs look loopback.
- **Dashboard filter:** `timeWindowQuerySchema` gains `env: z.enum(ENVIRONMENT_FILTER_VALUES).optional()`, where `ENVIRONMENT_FILTER_VALUES = [...ENVIRONMENT_VALUES,'all']`.
  - Absent means `'prod'`, applied in the API.
  - It is `.optional()`, not `.default()`, so the inferred `TimeWindowQuery` literals across the repo keep compiling.
- **Live, online, socket ticks and the Live snapshot are always prod-only.**
  - `LiveFeed` drops non-prod rows.
  - The online and snapshot SQL add `environment = 'prod'`.
  - There is no change to the socket room or scope-key contract.
- **Integration Health is NOT filtered.** It shows the environment mix, because it diagnoses staging wiring too.

### Browser release and client context (A5)
- **Release:** the browser envelope gains an optional top-level `release` (max `INGEST_LIMITS.maxReleaseLength` = 64), stored in the new column `web_events.release`. The SDK drops invalid values locally.
- **tz and lang limits:** the literals move to `INGEST_LIMITS.maxClientTzLength=64` and `maxClientLangLength=16`.
- **tz and lang storage:** `web_events.client_tz` and `client_lang`, nullable, with length CHECKs.
  - The enricher soft-drops values that fail `CLIENT_TZ_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/` or `CLIENT_LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/`, with FIELD_DROPPED `client.tz` / `client.lang`.
- **New vs returning devices:**
  - device = a distinct non-null `anonymous_id` on page_view rows in the window.
  - returning = also seen in `[from − RETURNING_DEVICE_LOOKBACK_MS (30 d), from)`.
  - new = device − returning.
  - The bounded lookback is documented in the repository INVARIANTS header.

### Remote config and kill switch (A7) → ADR 0009 `0009-sdk-remote-config-and-kill-switch.md`
- **Transport: `POST /v1/ingest/config`, `text/plain` body `{key, client?}`.**
  - It is a CORS simple request, so no preflight.
  - The key never appears in a URL or an access log.
- **Chain:** the browser chain, with these exceptions:
  - the new pre-auth CORS step (below) is mounted first;
  - a SEPARATE rate limiter instance `browserConfigRateLimit` is used, with the same per-minute budget as `browserKeyRateLimit` and an `onLimited` no-op. Config polls must never eat the ingest budget or inflate `ingest_counters.rate_limited`;
  - there is no session limiter and no rejection recorder.
- **Readable errors (pre-auth CORS).**
  - Today ACAO is set only after `publishableKeyAuth`. A cross-origin SDK therefore cannot read 400/401/403/413/415, sees a TypeError, and the kill switch never trips.
  - New `browserIngestEarlyCorsMiddleware(origins: AllowedOriginCache)` is mounted FIRST on POST `ingest.browser` and POST `ingest.config`.
  - It does `Vary: Origin`. When `origins.allows(origin)` is true (the same rule as the preflight: some active, browser-enabled app allows the origin), it reflects Origin, sets `Access-Control-Allow-Credentials: true`, and exposes `X-Nexus-Contract, Retry-After`.
  - The stricter per-app `browserIngestCors` stays after auth, unchanged.
  - Security is unchanged: success still needs `originGuard`, and reflection happens only for origins that are registered somewhere.
  - `AllowedOriginCache` (new, `apps/api/src/auth/allowed-origin.cache.ts`): an LRU with max 500 entries and a 30 s TTL over `AppRepository.anyAllowsOrigin`. It caches negatives too. It serves both the preflight and the early CORS, so beacons do not add a DB query. A 30 s lag is the same as AppKeyCache.
- **Storage:** columns on `traffic.apps`: `sdk_config_version int`, `sdk_disabled_modules text[]`, `sdk_config_updated_at`.
  - They ride `AppKeyCache` (30 s), so there is zero extra query.
  - `AppAdminService` already invalidates after commit.
- **Kill switch = the existing `apps.browser_ingest_enabled`.** It is already audited and already enforced at ingest for ALL SDK versions, including 1.0.0.
  - When it is off (or the app is off, or the key is bad), `/v1/ingest/config` answers 403/401 through `publishableKeyAuth`. The SDK treats any of `SDK_KILL_ERROR_CODES` as "disable everything".
  - The Apps-page dialog shows this switch as "Kill switch (browser capture)".
- **Module switches:** `SDK_CAPTURE_MODULE_VALUES = ['page_view','page_time','auto_tools','manual_tools','custom','header_propagation','retry_queue']`.
  - Remote config can only DISABLE. It never enables, and never turns propagation on.
  - Module switches need SDK ≥ 1.1.0. Old SDKs obey only the full kill, which ingest enforces.
- **Response `SdkRemoteConfig`:** `{contract: 1, version, enabled: true, disabledModules, maxAgeMs: SDK_DEFAULTS.browser.configMaxAgeMs}`, sent with `Cache-Control: no-store` (new constant `NO_STORE_CACHE` in `http/cache-control.ts`). `enabled` is reserved; a 200 always carries `true`.
- **API key usage:** the config route calls `authenticate(key, 'publishable', sdkLabel)` with the same label the tracker sends at ingest, so `last_sdk` stays meaningful. touchUsage is throttled.
- **SDK failure behaviour.** Capture fails OPEN, and a known kill is honoured.
  1. At start, apply the cached config for this key scope synchronously if it is younger than `configMaxStaleMs` (24 h); otherwise apply the code defaults.
  2. Fetch only when the cache is older than `maxAgeMs` (5 min).
     - Timeout `configTimeoutMs` 3000.
     - `credentials:'omit'`.
     - Use the CAPTURED native fetch (see A2).
     - Never block the host.
  3. A 200 with a valid shape and `version ≥ cached` → store and apply.
  4. An invalid body → ignore it.
  5. A status 401/403 whose `error.code ∈ SDK_KILL_ERROR_CODES` → cache `{enabled:false}` with recheck after `disabledRecheckMs` (15 min), and run `applyDisabled()` IN THE CURRENT PAGE (see A2/A6).
  6. Network error, TypeError/opaque response, 5xx or 429 → keep the current state.
  7. Ingest responses with a kill code also trip the disabled state.
- **Audit:** new `AUDIT_ACTION_VALUES` entry `'APP_SDK_CONFIG_UPDATE'`. The CHECK is swapped in 0009. Details are `{slug, version, disabledModules}`.
- **Concurrency:** the admin sends `expectedVersion`. A mismatch returns 409 `CONFLICT`.

### IP failure limiter fix (A7 side-effect) → recorded in ADR 0009
- Today `ipFailureLimitMiddleware` counts EVERY 401/403. Kill-switch 403s from un-updatable 1.0.0 SDKs behind an office NAT would therefore 429 ALL browser ingest from that IP, for every app.
- **New rule:** a response counts as a failure only if its status is 401/403 AND `res.locals.errorCode ∈ KEY_GUESS_ERROR_CODES` (`MISSING_API_KEY`, `INVALID_API_KEY`, `WRONG_KEY_TYPE`).
- `errorHandlerMiddleware` sets `res.locals.errorCode` before sending.
- Policy denials (`APP_DISABLED`, `BROWSER_INGEST_DISABLED`, `ORIGIN_NOT_ALLOWED`, `SECRET_KEY_EXPOSED`) are not counted.

### PII detector (A8) → ADR 0010 `0010-ingest-pii-detector.md`
- **Scrub, never reject.** A detection replaces the match and the event is kept.
  - Warning `FIELD_REDACTED` (new) `{index, code, field}`.
  - Counters `(app, source, field, kind, hour)`.
  - The matched value is never stored or logged.
- **Where:** API enrichment only, in the new class `PiiScrubber`.
  - Pass 1 runs BEFORE `RouteNormalizer` / `toEndpointId` / `toToolId`.
  - Pass 2 runs on the stored path columns only (below).
  - NEVER as a zod `.transform()`.
- **Kinds:** `PII_KIND_VALUES = ['email','phone','pan','gstin','aadhaar']`.
- **Fields:** `PII_FIELD_VALUES = ['path','route_template','referrer_path','label','prop_key','prop_value','tool','name','error_code','request_id','release']`. `userEmail` / `user.email` are excluded because they are intended.
- **Pattern sets** live in `constants/pii.ts`. Sources are strings, compiled with `gi`, in the order email → gstin → pan → aadhaar → phone.
  - **PATH-like** (path, route_template, referrer_path; strict, so ids don't split):
    - email: `[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}`
    - gstin: `(?<![A-Z0-9])[0-3][0-9][A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Z0-9])` plus the mod-36 checksum
    - pan: `(?<![A-Z0-9])[A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z](?![A-Z0-9])`
    - aadhaar (separators REQUIRED): `(?<!\d)[2-9]\d{3}(?:[\s-]|%20)\d{4}(?:[\s-]|%20)\d{4}(?!\d)` plus Verhoeff
    - phone (+91 REQUIRED): `(?:\+|%2B)91(?:[\s-]|%20)?[6-9]\d{9}(?!\d)`
  - **TEXT** (label, prop_value, prop_key, tool, name, error_code, request_id, release): the same email, gstin and pan patterns, plus:
    - aadhaar: `(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)` with Verhoeff
    - phone: `(?<![\d+])(?:\+91[\s-]?|0091[\s-]?|0)?[6-9]\d{9}(?!\d)`
  - **SEGMENT** (pass 2, stored `path` / `referrer_path` only): a whole `/`-delimited segment that is exactly `[6-9]\d{9}` → `:phone`, or exactly a Verhoeff-valid 12-digit run → `:aadhaar`.
    - It runs AFTER RouteNormalizer and the id hashing, so ids never split. The template already reads `:num`.
    - A 10-digit order id starting 6–9 is lost in the raw path only. This is an accepted, documented cost: the bare-mobile URL is the most common Indian-retail leak, and raw paths are kept for 6 months.
- **Replacement policy:**

  | Field | Action |
  |---|---|
  | path, route_template, referrer_path, label, prop_value | Replace the match with `PII_REDACTION_TOKENS[kind]` (`:email`, `:phone`, `:pan`, `:gstin`, `:aadhaar`). Each token is ≤ `PII_MIN_MATCH_LENGTH[kind]` (email 6, phone 10, pan 10, gstin 15, aadhaar 12), so length CHECKs can never break. |
  | tool, name | Replace the match with `PII_IDENTIFIER_REDACTION = 'redacted'` (keeps TOOL_NAME_PATTERN valid). |
  | prop_key | Drop the prop. |
  | error_code, request_id, release | Drop the field. |

  One detection is counted per (event, field, kind), across both passes.

### Retry queue (A6) → ADR 0012 `0012-browser-retry-queue.md`
- **In-page sends:** the CAPTURED native fetch (A2), `{method:'POST', keepalive:true, credentials:'include', body text/plain}`, so the status is readable. One batch is in flight at a time (the 64 KiB keepalive cap).
- **Unload** (`hidden` / `pagehide`) uses `sendBeacon`. `true` counts as delivered, avoiding duplicate inflation. If fetch is unavailable or throws synchronously, fall back to the beacon.
- **Outcomes**, all classified by `classifyDelivery(status, code)` in `core/transport.ts`:
  - 2xx → delivered.
  - 400, 413, 415, or 403 `ORIGIN_NOT_ALLOWED` → drop.
  - 401/403 with `code ∈ SDK_KILL_ERROR_CODES` → disabled. Drop the batch, PURGE this key scope's persisted queue, and run `applyDisabled()`.
  - 429, 5xx → retry with in-page back-off per `SDK_DEFAULTS.retry`; after `maxAttempts`, persist.
  - Network error / TypeError / opaque response (e.g. an origin registered nowhere) → back off; persist at most ONCE per batch.
- **Persistence:** only after a failed attempt.
  - **Storage:** localStorage key `${STORAGE_KEYS.retryQueue}:${keyScope}`, with `keyScope = publishableKey.slice(0,14)`. Several apps share the nexus.libas.in origin, and only the public prefix is used.
  - **Its own `RetryStorage`** (not `SafeStorage`). It always tries the real localStorage on get, set and remove. A QuotaExceeded or other error on write DROPS that persist and counts `persistFailed`. It never switches to memory, so `remove()` always reaches the real storage.
  - **Bounds:**
    - `retryQueueMaxBatches 20`
    - `retryQueueMaxBytes 128 KiB` per key scope (drop oldest; small, because host apps share the origin quota)
    - `retryQueueTtlMs 24 h`, measured on the batch's oldest `occurredAt`
    - `retryQueueMaxReplays 3`: a persisted batch replayed on 3 loads without delivery is dropped, so a poison batch cannot loop.
  - **Persisted entry:** `{envelope, attempts, replays}`. The envelope keeps `eventId`, `occurredAt`, `sessionId` and `seq` VERBATIM, is stored WITHOUT `user`, and gets `sentAt` re-stamped.
- **Replay:** on the next load, with `client.replay: true` (a new optional wire field).
  - The server SKIPS SSO-cookie identity for replays (stored anonymous) and records no SSO outcome.
  - Multi-tab: `navigator.locks.request(name, {ifAvailable:true})`. Without Locks, a claim record `{owner, at}` that goes stale after 60 s.
- **Counters stay SDK-local** (`getNexusStats()`). Wire reporting is future work, noted in ADR 0012.

### Header propagation (A2) → ADR 0011 `0011-header-propagation-and-early-entry.md`
Supersedes the ADR 0001 row "propagateHeaders opt-in".

- **Default on, same-origin only.** `propagateHeaders` defaults to `true` for same-origin requests. Same-origin custom headers never preflight.
- **`propagateHeadersTo: readonly string[]`** is an explicit list of exact cross-origin origins.
  - It is never set by remote config.
  - The docs warn that the target API must allow `X-Nexus-Session` / `X-Nexus-Page-View` in CORS.
- **Excluded URLs:** every `ROUTES.ingest.*` path under the collector base. `excludeUrls = [resolveIngestUrl(url), resolveConfigUrl(url)]` (prefix + path compare). The SDK's own transport and config client also bypass the patch entirely by using the captured native fetch.
- **Captured native fetch.** `state.nativeFetch ??= (globalThis.fetch.__nexusOriginal ?? globalThis.fetch)` is captured once, by `installNexusEarly` or by the first `acquireTracker`, BEFORE our patch is installed. Ingest and config use only this reference, so a later host interceptor (e.g. one adding Authorization) never touches our requests.
- **XHR patch** on `XMLHttpRequest.prototype` (`open` / `setRequestHeader` / `send`) covers axios. Semantics are fixed:
  - Every wrapper is a `function` (not arrow) that calls `original.apply(this, arguments)` and returns its result unchanged. `open` called with 2 args must stay async.
  - ONLY the decoration (computing and setting our headers) is inside try/catch. Exceptions from the original propagate exactly once, and the original is never invoked twice.
  - A WeakMap `xhr → {url, setNames:Set<lowercase>}` is RESET on every `open()`.
  - `setRequestHeader` records lowercase names, then calls the original.
  - `send` adds only the missing headers via the ORIGINAL `setRequestHeader`, each call wrapped so InvalidStateError never escapes.
  - Restore the prototype only if the methods are still ours.
- **Live gating per call.** Every fetch and XHR wrapper checks `isPropagationAllowed(source)` on EVERY call. That is false when `state.disabledKeys.has(source.keyScope)`, when the cached or remote config disables `header_propagation`, or when a local option is off. When it is false, the wrapper is a pure pass-through.
  - On entering the disabled state, `applyDisabled()` also restores `window.fetch` and the XHR prototype if they are still ours, even for the permanent early source.
- **Early entry `@nexus/react/early`** exports an EXPLICIT `installNexusEarly(options)`. `sideEffects: false` stays.
  - It imports no react, no `browser-tracker`, no `registry`, and no network code beyond URL helpers.
  - **Next ≥ 15.3:** call it from `src/instrumentation-client.ts`.
  - **Vite/CRA:** ESM imports are hoisted, so a call in `main.tsx`'s body runs AFTER the app graph, too late for openapi-fetch. Ship `docs/snippets/vite-nexus-early.ts`, an app-local module that calls `installNexusEarly(...)`, and require `import './nexus-early';` as the FIRST import of `main.tsx`.
  - `publishableKey` is REQUIRED, so the early install has a key scope and can be killed.
- **One session store.** A single `SessionStore` over a single `SafeStorage(sessionStorage)` lives in the v2 global state.
  - `SessionStore.peekCurrent(now)` never rotates on email change.
  - It DOES rotate on idle expiry (> `sessionIdleMs`). On rotation it persists `{id, seq: 0, lastActivityAt: now}` and keeps the stored email.
  - If there is no record, it creates and persists one.
  - It does not update `lastActivityAt` otherwise, so background polling does not extend a session.
- **Page-view header.**
  - The early install pre-allocates `pendingPageViewId`. The tracker's first `'load'` page_view uses it as its `eventId`.
  - `X-Nexus-Page-View` is the active view id (sent even after `view.ended`), else `pendingPageViewId`.
  - It is sent ONLY when the view's `sessionId` equals the current `peekCurrent` id, so a rotated session never gets paired with an old view.
- **New global state key:** `Symbol.for('@nexus/react/state@2')`.

### Route templates (A1)
- **Placeholder syntax:** `:name`. Catch-all `[...x]` / `[[...x]]` becomes `:x*`. basePath is prepended exactly as for the path.
- **Next adapter.** `nextRouteTemplate(pathname, params)`, where `params` may be `null`:
  - Walk the segments. A segment whose `decodeURIComponent` equals a scalar param becomes `:name`; a run equal to an array param becomes `:name*`.
  - If a value is not matched exactly once, or occurs twice, return `undefined`.
  - The WHOLE function and the `joinBasePath` of its result are wrapped in try/catch and return `undefined` on any throw. This code runs in render, outside `guard()`.
  - A `routeTemplate` prop overrides it.
- **Server plausibility guard** in BrowserEventEnricher, before scrubbing. Keep the template only if all of these hold:
  - it is within `app.base_path`;
  - its segment count equals the path's (or, with a trailing `*` segment, count − 1 ≤ path count);
  - every static segment equals the path segment case-insensitively up to the catch-all.

  Otherwise drop it with `FIELD_DROPPED` (`routeTemplate`) and fall back to guessing.
- **Cut-over:** `toPageId` changes for dynamic routes. There is no backfill. Document it in the CHANGELOG, PROGRESS and ADR 0013.

### Identity (A3)
- **Persist the SSO cookie outcome per browser batch** in `traffic.sso_cookie_outcomes (app, outcome, beacon_origin, hour)`.
  - `SSO_COOKIE_OUTCOME_VALUES = ['ok','no-cookie','no-secret','malformed','bad-alg','bad-signature','expired','not-yet-valid','wrong-type','no-email']`.
  - `SsoIdentityReader`'s failure reason is typed as `CookieFailureReason = Extract<CookieVerifyResult, {ok:false}>['reason']`, imported from `@nexus/auth`. It is no longer `string`. packages/auth is unchanged.
  - A compile-time test asserts `SsoCookieOutcome ≡ 'ok' | CookieFailureReason`, in both directions.
  - A cookie that verifies but whose email fails `plausibleEmail` maps to `'no-email'`.
  - `BEACON_ORIGIN_VALUES = ['same_origin','cross_origin','none']`, comparing the request Origin with `new URL(env.PUBLIC_ORIGIN).origin`.
  - Nothing is recorded for replays.
- **Identity coverage KPI:** `user_key IS NOT NULL` / rows. One SQL predicate, `IDENTIFIED_SQL(alias)`, is used by `summarizeActivityByApp` (Applications page: both sources COMBINED) AND by `sdkHealthSql` (Integration Health: PER SOURCE). The copy on each page says which one it shows.

### Linking (A2 KPI)
- **Linkable** = `api_requests` with `kind = 'http' AND ua_device IN ('desktop','mobile','tablet')`.
  - The literals come from the typed consts `const HTTP_KIND: ServerEventKind = 'http'` (the existing `PAGE_VIEW` pattern) and `LINKABLE_DEVICE_CLASSES`.
  - SSR, server-to-server calls, bots and downloads (`stream`) can never link, so they are excluded.
- `linked` = linkable rows with `session_id` set; `pageViewLinked` = linkable rows with `page_view_id` set.
- `AppTrafficDto.linkedPct` is REDEFINED on this denominator, through the same `LINKABLE_SQL` / `LINKED_SQL`.

### Rejections (A9) → in ADR 0013 `0013-integration-diagnostics-and-kpis.md`
- **Table** `traffic.ingest_rejections (app, source, sdk '', code, schema_path '', hour, rejected)`.
- **Codes:** `INGEST_REJECTION_CODE_VALUES = [...INGEST_EVENT_REJECT_CODES, 'INVALID_ENVELOPE', 'ORIGIN_NOT_ALLOWED']`.
  - Envelope-level rows are recorded only once the app is authenticated: server `INVALID_ENVELOPE` (validateBody runs after key auth) and browser `ORIGIN_NOT_ALLOWED`.
  - The recorder is mounted ONLY on POST `ingest.server` and POST `ingest.browser`. Config-route failures are never recorded.
- **sdk normalisation:** `normalizeSdkLabel(raw)` in `apps/api/src/domain/sdk-label.ts` keeps a value only if it matches `^[A-Za-z0-9@/._-]{1,maxSdkNameLength}@[0-9A-Za-z.+-]{1,maxSdkVersionLength}$`, else `''`.
  - For `ORIGIN_NOT_ALLOWED` rows, sdk is ALWAYS `''`. Only a public key is proven, so sender-chosen text must not create rows.
  - This also prevents the >100-char CHECK failure that would lose a whole upsert.
- **schema_path** = `normalizeSchemaPath(issue.path)`:
  - number → `*`;
  - the key after a `props` segment → `*`;
  - a segment not matching `/^[A-Za-z][A-Za-z0-9]{0,39}$/` → `*`;
  - joined with `.` and cut at `maxSchemaPathLength=128`.
  - Fixed values: `EVENT_TIME_OUT_OF_RANGE` → `occurredAt`; `PATH_OUTSIDE_APP` → `path`; `DB_CONSTRAINT` → the pg constraint name if the poison path exposes it, else `''`.
  - The zod message is NEVER stored.
- **Cardinality:** ≤ `REJECTION_MAX_DISTINCT_PER_BATCH = 20` distinct keys per batch; the rest are folded into `schema_path ''`.

### Integration level and warnings (A10)
- `INTEGRATION_LEVEL_VALUES = ['not_connected','partial','connected','complete']`:
  - `not_connected`: status `never`.
  - `partial`: status `stale`, or only one source has events.
  - `connected`: both sources have events.
  - `complete`: connected AND linking ratio ≥ `COVERAGE_TARGET_RATIO` (0.8) AND browser identity ratio ≥ 0.8 AND every source's release ratio ≥ `RELEASE_COVERAGE_TARGET` (0.95) AND none of the warnings `exposed_key` / `pii_detected` / `app_disabled`. A null ratio means not complete.
- **One new warning, `pii_detected`,** inserted right after `exposed_key`. Coverage is shown as numbers plus the level, not as warnings.
- `COVERAGE_MIN_EVENTS = 20`; below it the ratio is null.
- The web `COVERAGE_WARN_PCT = COVERAGE_TARGET_RATIO * 100`.

### Indexes (A11)
- `idx_api_requests_page_view_id ON traffic.api_requests (page_view_id) WHERE page_view_id IS NOT NULL`. It serves the `IN (subquery)` probe in `listPageApiCalls`.
- **BRIN: NOT added.** Monthly partitions, the PK btree `(occurred_at, event_id)` and `(app_id, occurred_at DESC)` already serve window scans. The verdict goes in ADR 0013 and `07-data-model.md`.

### Aggregate retention
- New hourly tables are pruned after `AGGREGATE_RETENTION_DAYS = 90`.
- Chain: `RetentionJob` → new `AggregateRetentionService.deleteExpired(exec)` → `AggregateRetentionRepository.deleteExpired(cutoff, exec)`. Same verb at every layer, and the job never calls a repository directly.
- It runs inside the existing retention advisory-lock callback, after `partitions.dropExpired`.
- `ingest_counters` is unchanged.

### Migrations
All files are contiguous, one concern each, with no BEGIN/COMMIT, no CONCURRENTLY, and `-- intent:` as the first line.

| File | Content |
|---|---|
| `0007_event_environment_and_client_context.sql` | environment on both tables; web_events client_tz, client_lang, release |
| `0008_api_requests_page_view_index.sql` | page_view_id index |
| `0009_app_sdk_config.sql` | apps sdk_config columns + admin_audit_log_action_check swap |
| `0010_ingest_rejections.sql` | rejection aggregates |
| `0011_pii_detections.sql` | PII counters |
| `0012_sso_cookie_outcomes.sql` | SSO outcome counters |

### ADRs (new files only; never edit 0001 or 0003)
- **0008** environment
- **0009** remote config, kill switch, key transport, pre-auth CORS, config limiter, IP-failure-limiter rule
- **0010** PII detector (two passes, segment scrub)
- **0011** header propagation v2, the early entry, XHR semantics, captured native fetch
- **0012** retry queue and replay identity
- **0013** integration diagnostics: the 3 tables, KPI definitions, level, aggregate retention, the page_view_id index, the BRIN verdict, the page-id cut-over

### SDK versions
`@nexus/react`, `@nexus/node` and `@nexus/express` all go to **1.1.0**. Tarballs are immutable.

### SDK import allowlist
SDKs may import only zod-free subpaths:
- `@nexus/shared/constants`
- `/routes`
- `/errors` (new on the list; it is zod-free and already exported)
- `/ingest/build-ingest-url`
- `/ingest/client-ip`

---

## 2. Contract changes in `packages/shared` (all additive within v1; Wave 1)

### `src/constants/traffic.ts`
```ts
export const ENVIRONMENT_VALUES = ['prod', 'staging', 'dev'] as const;
export type Environment = (typeof ENVIRONMENT_VALUES)[number];
export const DEFAULT_ENVIRONMENT: Environment = 'prod';
export const ENVIRONMENT_FILTER_VALUES = [...ENVIRONMENT_VALUES, 'all'] as const;
export type EnvironmentFilter = (typeof ENVIRONMENT_FILTER_VALUES)[number];

export const SDK_CAPTURE_MODULE_VALUES = ['page_view','page_time','auto_tools','manual_tools','custom','header_propagation','retry_queue'] as const;
export type SdkCaptureModule = (typeof SDK_CAPTURE_MODULE_VALUES)[number];

export const SSO_COOKIE_OUTCOME_VALUES = ['ok','no-cookie','no-secret','malformed','bad-alg','bad-signature','expired','not-yet-valid','wrong-type','no-email'] as const;
export type SsoCookieOutcome = (typeof SSO_COOKIE_OUTCOME_VALUES)[number];
export const BEACON_ORIGIN_VALUES = ['same_origin','cross_origin','none'] as const;
export type BeaconOrigin = (typeof BEACON_ORIGIN_VALUES)[number];

/** Mirrors apps/api/src/enrichment/user-agent.parser.ts DEVICE_CLASSES (browser-capable classes). */
export const LINKABLE_DEVICE_CLASSES = ['desktop','mobile','tablet'] as const;

export const BREAKDOWN_DIMENSION_VALUES = ['browser','os','device','referrer_host','nav','time_reason','client_tz','client_lang','release','environment'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSION_VALUES)[number];
export const SERVER_BREAKDOWN_DIMENSION_VALUES = ['browser','os','device','release','environment'] as const satisfies readonly BreakdownDimension[];
export type ServerBreakdownDimension = (typeof SERVER_BREAKDOWN_DIMENSION_VALUES)[number];

// AUDIT_ACTION_VALUES: append 'APP_SDK_CONFIG_UPDATE' (last position)
```

### `src/constants/ingest.ts`
- `INGEST_LIMITS` adds `maxEnvironmentWireLength: 32`, `maxClientTzLength: 64`, `maxClientLangLength: 16`, `maxSchemaPathLength: 128`.
- Add `CLIENT_TZ_PATTERN` and `CLIENT_LANG_PATTERN` (§1).
- `SDK_DEFAULTS.browser` adds:
  - `retryQueueMaxBatches: 20`
  - `retryQueueMaxBytes: 128 * 1024`
  - `retryQueueTtlMs: 24 * HOUR`
  - `retryQueueMaxReplays: 3`
  - `configMaxAgeMs: 5 * 60_000`
  - `configMaxStaleMs: 24 * HOUR`
  - `configTimeoutMs: 3000`
  - `disabledRecheckMs: 15 * 60_000`
  - `xhrPatch: true`
- Add `REJECTION_MAX_DISTINCT_PER_BATCH = 20`.

### `src/constants/pii.ts` (NEW, zod-free; add `export * from './pii'` to `constants/index.ts`)
- `PII_KIND_VALUES` / `PiiKind`, `PII_FIELD_VALUES` / `PiiField`.
- `PII_REDACTION_TOKENS: Readonly<Record<PiiKind,string>>` = `{email:':email', phone:':phone', pan:':pan', gstin:':gstin', aadhaar:':aadhaar'}`.
- `PII_MIN_MATCH_LENGTH: Readonly<Record<PiiKind,number>>` = `{email:6, phone:10, pan:10, gstin:15, aadhaar:12}`.
- `PII_IDENTIFIER_REDACTION = 'redacted'`.
- `PII_PATH_PATTERN_SOURCES`, `PII_TEXT_PATTERN_SOURCES`: `Readonly<Record<PiiKind,string>>`.
- `PII_SEGMENT_PATTERN_SOURCES: Readonly<{phone: string; aadhaar: string}>` = `{phone: '^[6-9]\\d{9}$', aadhaar: '^[2-9]\\d{11}$'}`. The Aadhaar source needs Verhoeff as a post-filter.
- `PII_DETECTION_ORDER: readonly PiiKind[] = ['email','gstin','pan','aadhaar','phone']`.
- `isVerhoeffValid(digits: string): boolean` and `isGstinChecksumValid(gstin: string): boolean` (mod-36 weighted, case-insensitive).

### `src/constants/integration.ts`
- Insert `'pii_detected'` into `INTEGRATION_WARNING_VALUES` right after `'exposed_key'`.
- Add:
  - `COVERAGE_MIN_EVENTS = 20`
  - `COVERAGE_TARGET_RATIO = 0.8`
  - `RELEASE_COVERAGE_TARGET = 0.95`
  - `INTEGRATION_LEVEL_VALUES` + `IntegrationLevel`
  - `AGGREGATE_RETENTION_DAYS = 90`
  - `MAX_REJECTION_ROWS_PER_APP = 20`

### `src/constants/time.ts`
- `RETURNING_DEVICE_LOOKBACK_MS = 30 * DAY`.

### `src/errors.ts` (stays zod-free)
- `ERROR_CODES.FIELD_REDACTED: 'FIELD_REDACTED'`.
- `INGEST_WARNING_CODES = [FIELD_DROPPED, FIELD_TRUNCATED, FIELD_REDACTED]`.
- `INGEST_REJECTION_CODE_VALUES = [...INGEST_EVENT_REJECT_CODES, ERROR_CODES.INVALID_ENVELOPE, ERROR_CODES.ORIGIN_NOT_ALLOWED] as const` + `IngestRejectionCode`.
- `SDK_KILL_ERROR_CODES = [ERROR_CODES.APP_DISABLED, ERROR_CODES.BROWSER_INGEST_DISABLED, ERROR_CODES.INVALID_API_KEY, ERROR_CODES.WRONG_KEY_TYPE, ERROR_CODES.SECRET_KEY_EXPOSED] as const`. A 401/403 with these codes makes the browser SDK stop.
- `KEY_GUESS_ERROR_CODES = [ERROR_CODES.MISSING_API_KEY, ERROR_CODES.INVALID_API_KEY, ERROR_CODES.WRONG_KEY_TYPE] as const`. Only these count toward the IP failure limiter.

### `src/ingest/schemas.ts`
- `serverIngestEnvelopeSchema` gains `environment: z.string().min(1).max(INGEST_LIMITS.maxEnvironmentWireLength).optional()`.
- `browserIngestEnvelopeSchema` gains:
  - the same `environment`;
  - `release: z.string().min(1).max(INGEST_LIMITS.maxReleaseLength).optional()`;
  - `client.tz` → `.max(INGEST_LIMITS.maxClientTzLength)`, `client.lang` → `.max(INGEST_LIMITS.maxClientLangLength)`;
  - `client.replay: z.boolean().optional()`.
- NEW `sdkConfigRequestSchema = z.object({ key: z.string().min(1).max(64), client: z.object({ sdk: z.string().min(1).max(INGEST_LIMITS.maxSdkNameLength), version: z.string().min(1).max(INGEST_LIMITS.maxSdkVersionLength) }).optional() })` + `SdkConfigRequest`.
- NEW `sdkRemoteConfigSchema = z.object({ contract: z.literal(INGEST_CONTRACT_VERSION), version: z.int().min(1), enabled: z.boolean(), disabledModules: z.array(z.enum(SDK_CAPTURE_MODULE_VALUES)), maxAgeMs: z.int().min(0) })` + `SdkRemoteConfig`.
- NO `.transform()` anywhere.

### `src/ingest/examples.ts`
- `SERVER_BATCH_EXAMPLE` adds `environment: 'prod'`.
- `BROWSER_BATCH_EXAMPLE` adds `environment: 'prod'` and `release: '2026.11.18-a1b2c3d'`; its page_view gets a `routeTemplate` that matches its path.
- `SDK_CONFIG_RESPONSE_EXAMPLE satisfies SdkRemoteConfig`.

### `src/routes.ts`
- `ingest.config: { method: 'POST', path: '/v1/ingest/config' }`
- `apps.updateSdkConfig: { method: 'PATCH', path: '/v1/apps/:slug/sdk-config' }`
- `overview.breakdown: { method: 'GET', path: '/v1/overview/breakdown' }`
- `overview.devices: { method: 'GET', path: '/v1/overview/devices' }`
- `PENDING_ROUTE_LEAVES` stays `[]`.

### `src/schemas/common.ts`
- `timeWindowQuerySchema` gets `env: z.enum(ENVIRONMENT_FILTER_VALUES).optional()` inside the `z.object`, before `.refine`.

### `src/schemas/analytics.ts`
```ts
export const BREAKDOWN_LIMIT_DEFAULT = 10; export const BREAKDOWN_LIMIT_MAX = 50;
export const breakdownOverviewQuerySchema = timeWindowQuerySchema.safeExtend({
  source: z.enum(INGEST_SOURCE_VALUES).default('browser'),
  dimension: z.enum(BREAKDOWN_DIMENSION_VALUES),
  limit: z.coerce.number().int().min(1).max(BREAKDOWN_LIMIT_MAX).default(BREAKDOWN_LIMIT_DEFAULT),
}).refine((q) => q.source === 'browser' || (SERVER_BREAKDOWN_DIMENSION_VALUES as readonly string[]).includes(q.dimension),
  { message: 'dimension not available for source=server', path: ['dimension'] });
export type BreakdownOverviewQuery = z.infer<typeof breakdownOverviewQuerySchema>;
export const devicesOverviewQuerySchema = timeWindowQuerySchema;
export type DevicesOverviewQuery = z.infer<typeof devicesOverviewQuerySchema>;
```
`liveFilterSchema` is unchanged.

### `src/schemas/apps.ts`
```ts
export const updateSdkConfigBodySchema = z.object({
  expectedVersion: z.int().min(1),
  disabledModules: z.array(z.enum(SDK_CAPTURE_MODULE_VALUES)).max(SDK_CAPTURE_MODULE_VALUES.length)
    .refine((m) => new Set(m).size === m.length, 'duplicate module'),
});
export type UpdateSdkConfigBody = z.infer<typeof updateSdkConfigBodySchema>;
```

### DTOs (type-only)

**`dto/apps.ts`**
- `SdkConfigDto { version: number; disabledModules: SdkCaptureModule[]; updatedAt: string | null }`.
- `AppDto.sdkConfig: SdkConfigDto`. It is not secret; `apps.list` is served to all viewers, and that is accepted.

**`dto/overview.ts`**
- `BreakdownItemDto { value: string | null; events: number; share: number }`.
- `BreakdownDto extends WindowedListDto<BreakdownItemDto> { source: IngestSource; dimension: BreakdownDimension; total: number }`.
- `DeviceReturnDto { window: TimeWindowDto; lookbackFrom: string; devices: number; newDevices: number; returningDevices: number }`.
- Doc updates:
  - `AppTrafficDto.linkedPct`: "% of linkable (browser-originated http) API calls linked to a browser session".
  - `identifiedPct`: "both sources combined".

**`dto/integration.ts`**
- `SdkHealthDto` gains `name: string | null; version: string | null` (split at the last `'@'` at an index > 0).
- New DTOs:
```ts
export interface CoverageDto { source: IngestSource; events: number; covered: number; ratio: number | null }
export interface LinkingCoverageDto { linkable: number; linked: number; pageViewLinked: number; ratio: number | null }
export interface EnvironmentMixDto { source: IngestSource; environment: Environment; events: number }
export interface ReleaseStatusDto { source: IngestSource; events: number; withRelease: number; ratio: number | null; latestRelease: string | null }
export interface PiiDetectionDto { source: IngestSource; field: PiiField; kind: PiiKind; detections: number }
export interface RejectionReasonDto { source: IngestSource; sdk: string | null; code: IngestRejectionCode; schemaPath: string | null; rejected: number }
export interface SsoCookieOutcomeDto { outcome: SsoCookieOutcome; beaconOrigin: BeaconOrigin; beacons: number }
```
- `AppIntegrationHealthDto` adds:
  - `identityCoverage: CoverageDto[]` (one per source, always)
  - `linkingCoverage: LinkingCoverageDto`
  - `environments: EnvironmentMixDto[]`
  - `releases: ReleaseStatusDto[]` (one per source, always)
  - `piiDetections: PiiDetectionDto[]` (busiest first)
  - `rejections: RejectionReasonDto[]` (busiest first, ≤ MAX_REJECTION_ROWS_PER_APP)
  - `ssoCookieOutcomes: SsoCookieOutcomeDto[]`
  - `level: IntegrationLevel`

### Tests (`contracts.test.ts`, `ingest/schemas.test.ts`, new `constants/pii.test.ts`)
- `SDK_DEFAULTS.browser.retryQueueTtlMs < EVENT_CLOCK_POLICY.maxBackdateMs / 2`.
- `ENVIRONMENT_FILTER_VALUES` = `ENVIRONMENT_VALUES` + `'all'`.
- The server breakdown dimensions are a subset of the browser ones.
- **Token length:** for every kind, `PII_REDACTION_TOKENS[kind].length <= PII_MIN_MATCH_LENGTH[kind]`, and `PII_IDENTIFIER_REDACTION` matches `TOOL_NAME_PATTERN`.
- `SDK_KILL_ERROR_CODES` and `KEY_GUESS_ERROR_CODES` ⊆ `Object.values(ERROR_CODES)`.
- The new routes follow the `/v1` rule.
- `timeWindowQuerySchema.parse({}).env === undefined`.
- The examples parse.
- An unknown `environment` string still parses.
- `sdkRemoteConfigSchema` parses `SDK_CONFIG_RESPONSE_EXAMPLE`.
- PII vectors:
  - positives: emails including `a%40b.com`; PAN `ABCPE1234F` (and lower-case); GSTIN `27AAPFU0939F1ZV` (assert the checksum with the implemented function); a Verhoeff-valid 12-digit number, generated with the algorithm; `+91 9876543210`;
  - segment positives: `9876543210` and a Verhoeff-valid 12-digit string against `PII_SEGMENT_PATTERN_SOURCES`;
  - negatives: a 10-digit id in a PATH pattern (not detected by pass 1); a Verhoeff-invalid 12-digit run; a uuid; `audits.export-csv`.

---

## 3. Work packages

### Ownership rule
- Every file is owned by exactly ONE package.
- Anyone may READ any file.
- A change needed in a file you do not own goes through the §4 interface: the owner makes it.

### Gate expectations
- **Wave 1** passes its own scoped gates.
- **Repo-wide `npm run typecheck && npm test`** is expected to fail between Wave 1 and the end of Wave 2.
- **P4 and P5 are ONE api integration unit.**
  - On its own, each runs only scoped vitest on its own files: `npx vitest run <its files>` from apps/api.
  - `npm run typecheck -w @nexus/api`, `npm test -w @nexus/api` and the api DB suites run once both have landed, at the Wave 2 checkpoint.
  - To keep the router buildable early, **P5's FIRST deliverable** is the three controller arrow properties and the three service method signatures, with bodies that may temporarily `throw new Error('not implemented')`.
- **P3's node contract tests read files that P2 creates** (`early.ts` and the new snippets). P3 runs `npm test -w @nexus/node` after P2 has landed those files; until then it runs only its other suites.

---

### WAVE 1 — P1 `contract-db` (one implementer, done first)

**Goal:** the contract and the schema.

**Files (create or edit):**
- `packages/shared/src/constants/{traffic.ts, ingest.ts, integration.ts, time.ts, index.ts}`
- new `packages/shared/src/constants/pii.ts`, new `packages/shared/src/constants/pii.test.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/ingest/{schemas.ts, examples.ts, index.ts, schemas.test.ts}`
- `packages/shared/src/routes.ts`
- `packages/shared/src/schemas/{common.ts, analytics.ts, apps.ts, index.ts}`
- `packages/shared/src/dto/{apps.ts, overview.ts, integration.ts, index.ts}`
- `packages/shared/src/contracts.test.ts`, `packages/shared/src/index.ts` (if the barrel needs it)
- `apps/api/migrations/0007_…sql` through `0012_…sql`
- `apps/api/migrations/README.md`: the table catalogue, plus the corrected rule "new tables MUST be added to grants.ts; default privileges do not cover fresh DBs"
- `apps/api/src/db/migration-runner/grants.ts`
- `apps/api/test/db/schema-parity.integration.test.ts`
- `apps/api/test/db/migration-runner.integration.test.ts`
- `apps/api/test/db/privileges.integration.test.ts`
- `scripts/emit-openapi.ts`, `docs/openapi.json`

**Steps:**
1. **Shared.** Make every §2 change, with a WHY doc comment on each new export.
2. **Migration SQL.** Use the constraint names exactly as written here.
   - **0007:**
     ```sql
     ALTER TABLE traffic.api_requests ADD COLUMN environment text NOT NULL DEFAULT 'prod';
     ALTER TABLE traffic.api_requests ADD CONSTRAINT api_requests_environment_check CHECK (environment IN ('prod','staging','dev')); -- ENVIRONMENT_VALUES
     ALTER TABLE traffic.web_events ADD COLUMN environment text NOT NULL DEFAULT 'prod', ADD COLUMN client_tz text NULL, ADD COLUMN client_lang text NULL, ADD COLUMN release text NULL;
     ```
     Then add:
     - `web_events_environment_check`
     - `web_events_client_tz_check CHECK (client_tz IS NULL OR char_length(client_tz) <= 64)`
     - `web_events_client_lang_check (… <= 16)`
     - `web_events_release_check (release IS NULL OR char_length(release) <= 64)`
   - **0008:**
     ```sql
     CREATE INDEX idx_api_requests_page_view_id ON traffic.api_requests (page_view_id) WHERE page_view_id IS NOT NULL;
     ```
   - **0009:**
     - `ALTER TABLE traffic.apps ADD COLUMN sdk_config_version integer NOT NULL DEFAULT 1, ADD COLUMN sdk_disabled_modules text[] NOT NULL DEFAULT '{}', ADD COLUMN sdk_config_updated_at timestamptz NULL;`
     - `apps_sdk_config_version_check CHECK (sdk_config_version >= 1)`
     - `apps_sdk_disabled_modules_check CHECK (sdk_disabled_modules <@ ARRAY['page_view','page_time','auto_tools','manual_tools','custom','header_propagation','retry_queue']::text[])`
     - `ALTER TABLE traffic.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check, ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (<7 values>));`
   - **0010 `traffic.ingest_rejections`:**

     | Column | Definition | Constraint |
     |---|---|---|
     | `app_id` | `uuid NOT NULL REFERENCES traffic.apps (id)` | |
     | `source` | `text NOT NULL` | `ingest_rejections_source_check IN ('server','browser')` |
     | `sdk` | `text NOT NULL DEFAULT ''` | `ingest_rejections_sdk_check (char_length(sdk) <= 100)` |
     | `code` | `text NOT NULL` | `ingest_rejections_code_check IN (6 codes)` |
     | `schema_path` | `text NOT NULL DEFAULT ''` | `ingest_rejections_schema_path_check (char_length(schema_path) <= 128 AND schema_path ~ '^[A-Za-z0-9_.*]*$')` |
     | `bucket_hour` | `timestamptz NOT NULL` | |
     | `rejected` | `integer NOT NULL` | `ingest_rejections_rejected_check (rejected >= 0)` |

     - `PRIMARY KEY (app_id, source, sdk, code, schema_path, bucket_hour)`
     - `CREATE INDEX idx_ingest_rejections_bucket_hour ON traffic.ingest_rejections (bucket_hour);`
   - **0011 `traffic.pii_detections`:**
     - Columns: `app_id`, `source` (`pii_detections_source_check`), `field` (`pii_detections_field_check`), `kind` (`pii_detections_kind_check`), `bucket_hour`, `detections integer NOT NULL` (`pii_detections_detections_check >= 0`).
     - PK `(app_id, source, field, kind, bucket_hour)`; index `idx_pii_detections_bucket_hour`.
   - **0012 `traffic.sso_cookie_outcomes`:**
     - Columns: `app_id`, `outcome` (`sso_cookie_outcomes_outcome_check`), `beacon_origin` (`sso_cookie_outcomes_beacon_origin_check`), `bucket_hour`, `beacons integer NOT NULL` (`sso_cookie_outcomes_beacons_check >= 0`).
     - PK `(app_id, outcome, beacon_origin, bucket_hour)`; index `idx_sso_cookie_outcomes_bucket_hour`.
3. **`grants.ts`.** Add `traffic.ingest_rejections`, `traffic.pii_detections` and `traffic.sso_cookie_outcomes` to the explicit DML list (SELECT, INSERT, UPDATE, DELETE).
4. **Parity.**
   - ENUM_CHECKS rows:
     - `api_requests_environment_check`, `web_events_environment_check` (ENVIRONMENT_VALUES)
     - `apps_sdk_disabled_modules_check` (SDK_CAPTURE_MODULE_VALUES)
     - `ingest_rejections_source_check` (INGEST_SOURCE_VALUES)
     - `ingest_rejections_code_check` (INGEST_REJECTION_CODE_VALUES)
     - `pii_detections_{source,field,kind}_check`
     - `sso_cookie_outcomes_{outcome,beacon_origin}_check`
     - The `admin_audit_log_action_check` row now has 7 values.
   - TEXT_CHECKS rows:
     - `web_events_client_tz_check` (`<= ${INGEST_LIMITS.maxClientTzLength}`)
     - `web_events_client_lang_check`
     - `web_events_release_check` (`maxReleaseLength`)
     - `ingest_rejections_schema_path_check` (`maxSchemaPathLength`)
   - Add a pg_indexes assertion: `idx_api_requests_page_view_id` exists on the parent and on one partition.
5. **Runner tests.**
   - `ALL_MIGRATIONS` lists 0001–0012.
   - Add `const FREE_VERSION = String(ALL_MIGRATIONS.length + 1).padStart(4,'0')`.
   - Replace EVERY hard-coded `0007_` temp file (≈L204, L241/244, L253, L267/272) with `${FREE_VERSION}_never_applied.sql` and so on. The same applies to the expected values `['0007_extra.sql']` → `[`${FREE_VERSION}_extra.sql`]` and `['0007_future_table']` → `[`${FREE_VERSION}_future_table`]`.
   - Rollback test:
     - version assertion → `ALL_MIGRATIONS.slice(4).map((m) => m.slice(0, 4))`;
     - guard assertion → `ALL_MIGRATIONS.slice(4)` (labels).
   - `privileges.integration.test.ts`: the ledger count becomes `loadMigrations(MIGRATIONS_DIR).length`. Add a test that nexus_app can upsert into each of the 3 new tables.
6. **OpenAPI.**
   - In `emit-openapi.ts`, add components `SdkConfigRequest` and `SdkRemoteConfig`.
   - `buildPaths()` gets `POST /v1/ingest/config`: request `text/plain` + `application/json` with `SdkConfigRequest`; responses 200 `SdkRemoteConfig`, and 400/401/403/413/415/429 `ErrorEnvelope`.
   - Run `npm run openapi:emit`.

**Acceptance:**
- Shared typechecks and its tests pass.
- Migrations apply on PG18.
- The parity, privileges and runner suites are green.
- `openapi:emit -- --check` is clean.

**Verify:**
```
npm run typecheck -w @nexus/shared && npm test -w @nexus/shared && npm run build:shared
npm run openapi:emit -- --check
npx vitest run src/db/migration-runner/loader.test.ts        (cwd apps/api)
npm run test:db -w @nexus/api -- test/db/schema-parity.integration.test.ts test/db/migration-runner.integration.test.ts test/db/privileges.integration.test.ts
```

---

### WAVE 2 (parallel: P2–P6)

#### P2 `react-sdk`

**Goal:**
- A1: template stamping and the Next adapter.
- A2: XHR patch, early entry, session fixes, live gating, captured fetch.
- A4/A5: environment and release on the wire.
- A6: retry queue.
- A7: remote config and in-page kill.
- Release 1.1.0.

**Files:**
- `packages/react/package.json`: version 1.1.0, a new `./early` export block (`@nexus/source` / import / require / types), `sideEffects` stays `false`.
- `packages/react/tsup.config.ts`: a third config `entry: { early: 'src/early.ts' }`, no 'use client' banner, same externals and noExternal.
- `packages/react/README.md`
- `packages/react/src/{index.ts, next.tsx, early.ts (new), use-nexus-tracker.ts}`
- `packages/react/src/core/{browser-tracker.ts, registry.ts, global-state.ts, session-store.ts, safe-storage.ts, fetch-patch.ts, transport.ts, event-batcher.ts, sdk-info.ts, wire.ts, paths.ts}`
- New core files:
  - `core/ingest-urls.ts`: leaf; `resolveIngestUrl`, `resolveConfigUrl`; imports only `@nexus/shared/routes` and `/ingest/build-ingest-url`
  - `core/config-cache.ts`: `readCachedConfig` / `writeCachedConfig`; no network code
  - `core/xhr-patch.ts`, `core/header-source.ts`, `core/route-template.ts`, `core/retry-queue.ts`, `core/retry-storage.ts`, `core/remote-config.ts`, `core/environment.ts`, `core/stats.ts`
  - `core/kill.ts`: `applyDisabledForScope(keyScope)`
- Tests:
  - `src/{core/core.test.ts, use-nexus-tracker.test.tsx, next.test.tsx, test-harness.ts}`
  - new `src/early.test.ts`
  - new `src/core/{xhr-patch.test.ts, retry-queue.test.ts, remote-config.test.ts, route-template.test.ts, header-source.test.ts}`
- Snippets:
  - `docs/snippets/next-tracker.tsx`, `docs/snippets/vite-react-tracker.tsx`
  - new `docs/snippets/next-instrumentation-client.ts`
  - new `docs/snippets/vite-nexus-early.ts`

**Steps:**
1. **`sdk-info.ts`**
   - `SDK_VERSION='1.1.0'`.
   - `STORAGE_KEYS` gains `retryQueue: 'nexus.retry'` and `config: 'nexus.config'`.
   - `keyScope(publishableKey) = publishableKey.slice(0,14)`.
2. **`global-state.ts`**
   - Symbol `'@nexus/react/state@2'`.
   - State shape: `{trackers, active, headerSources: Set<HeaderSource>, fetchPatch: {original, patched} | null, xhrPatch: {open, send, setRequestHeader} | null, nativeFetch: typeof fetch | null, session: SessionStore | null, pendingPageViewId: string | null, earlySource: HeaderSource | null, disabledKeys: Set<string>, remote: Map<keyScope, SdkRemoteConfigWire>}`.
   - `sharedSessionStore()` lazily creates ONE `SafeStorage(sessionStorage)` plus one `SessionStore`.
   - `captureNativeFetch()` does `state.nativeFetch ??= fetch.__nexusOriginal ?? fetch`. It must be called before any patch is installed.
3. **`session-store.ts`**
   - Add `peekCurrent(now): string`. It rotates on idle only (persists `{id, seq:0, lastActivityAt: now, email}`), creates a record when there is none, and never rotates on email.
   - Remove `peek` if nothing else uses it.
   - The page-view header pairing (`view.sessionId`) is checked in header-source.
4. **`ingest-urls.ts`**
   - Move `resolveIngestUrl` out of `registry.ts`. Registry re-imports it.
   - Add `resolveConfigUrl(url)`: the same base resolution, using `buildIngestUrl(base, ROUTES.ingest.config)`.
   - Add `ingestExcludeUrls(url) = [resolveIngestUrl(url), resolveConfigUrl(url)]`.
5. **`header-source.ts`**
   - `HeaderSource { keyScope: string; excludeUrls: readonly string[]; allowOrigins: readonly string[]; headers(): Record<string,string> }`.
   - `createHeaderSource({keyScope, excludeUrls, allowOrigins, pageView: () => {id: string; sessionId: string} | null})`.
     - It returns `{[INGEST_HEADERS.session]: sid}` where `sid = sharedSessionStore().peekCurrent(Date.now())`.
     - It adds `[INGEST_HEADERS.pageView]` only when `pageView()?.sessionId === sid`.
   - `shouldDecorate(url, source)` = not excluded AND (same-origin OR the normalised origin ∈ `allowOrigins`) AND `isPropagationAllowed(source)`.
   - `isPropagationAllowed(source)` reads LIVE state on every call: not `disabledKeys.has(keyScope)`, and `header_propagation` is not in `state.remote.get(keyScope)?.disabledModules`.
6. **`fetch-patch.ts`**
   - Use `headerSources` (newest wins).
   - Export `isSameOrigin` and `isExcluded`.
   - Only `decorate()` is inside try/catch. `original.call` stays outside it (today's shape).
   - `releaseFetchPatchIfOurs()` restores fetch only when `window.fetch === state.fetchPatch.patched`.
7. **`xhr-patch.ts`**
   - `installXhrPatch()` / `releaseXhrPatchIfOurs()`, following the §1 XHR semantics exactly:
     - `function` wrappers with `original.apply(this, arguments)`;
     - the WeakMap is reset on each `open`;
     - decoration only inside try/catch;
     - guarded `setRequestHeader` on send.
   - Respect `SDK_DEFAULTS.browser.xhrPatch`.
8. **`early.ts`**
   ```ts
   export interface NexusEarlyOptions { url: string | undefined; publishableKey: string | undefined; propagateHeaders?: boolean; propagateHeadersTo?: readonly string[]; disabled?: boolean }
   export function installNexusEarly(options: NexusEarlyOptions): void
   ```
   - The fields are typed `string | undefined`, so `process.env.X` passes. The function is a no-op unless both are non-empty strings.
   - It never throws.
   - It is also a no-op when: disabled, not in a browser, `readCachedConfig(keyScope)` is cached-disabled, or the cache lists `header_propagation`.
   - Otherwise:
     - `captureNativeFetch()`;
     - `pendingPageViewId ??= createUuid()`;
     - `earlySource = createHeaderSource({keyScope, excludeUrls: ingestExcludeUrls(url), allowOrigins: propagateHeadersTo ?? [], pageView: () => state.active?.currentView() ?? pendingView()})`, where `pendingView` pairs `pendingPageViewId` with the current session id;
     - install the fetch and XHR patches with it as a permanent source.
   - Imports allowed: `core/{global-state, header-source, fetch-patch, xhr-patch, session-store, safe-storage, uuid, config-cache, ingest-urls, sdk-info}` and `@nexus/shared/{constants, routes, ingest/build-ingest-url}`. NO react, `browser-tracker`, `registry` or `remote-config`.
9. **`route-template.ts`**
   - `toWireRouteTemplate(value)`: strip `?#`, force a leading `/`, return `undefined` if over 256 chars.
   - `nextRouteTemplate(pathname, params: Record<string, string | string[] | undefined> | null)` follows §1 and is wrapped entirely in try/catch.
   - `next.tsx` adds `useParams()`. `template = safe(() => joinBasePath(basePath, nextRouteTemplate(pathname, params)))`, unless the `routeTemplate` prop is set.
10. **`use-nexus-tracker.ts`**
    - New options:
      - `routeTemplate?: string | null`
      - `environment?: NexusEnvironment`
      - `release?: string`
      - `propagateHeadersTo?: readonly string[]`
      - `remoteConfig?: boolean` (default true)
      - `persistRetries?: boolean` (default true)
    - `propagateHeaders` defaults to `true`.
    - Effect 3 becomes `tracker.setPath(pathname, routeTemplate)`, with the template in its deps.
    - Effect 1's deps gain environment, release, `propagateHeadersTo.join(',')`, remoteConfig and persistRetries.
    - `NexusEnvironment` is the literal `'prod' | 'staging' | 'dev'`, with two-way assertions against the shared `Environment`.
    - Export `getNexusStats(): NexusStats` from `core/stats.ts`: `{queued, droppedOverflow, persisted, persistFailed, replayed, expired, droppedReplayCap, configVersion: number | null, disabled: boolean}`.
11. **`browser-tracker.ts`**
    - `PageViewState` gains `routeTemplate?` and `sessionId`.
    - `setPath(path, template?)` stamps `routeTemplate` on EVERY event of the view.
    - The first load uses `eventId = consume(state.pendingPageViewId)`.
    - Add `currentView(): {id, sessionId} | null`.
    - `setOptions` applies ALL options.
    - `serialize` adds:
      - `environment` = the option, else `defaultEnvironment(location.hostname)` (loopback → `'dev'`, otherwise omitted);
      - `release`, dropped if over 64 chars.
    - `isModuleOn(m)` is the single gate. The gate sites are the same as in v1.
    - `start()` calls `captureNativeFetch()` first.
12. **`kill.ts`: `applyDisabledForScope(keyScope)`.** Called by the transport and by remote-config on a kill code. It:
    - adds the scope to `disabledKeys`;
    - stops the interval of the matching trackers and drops their queues;
    - purges `${STORAGE_KEYS.retryQueue}:${keyScope}` through `RetryStorage.remove`;
    - writes the cached config as disabled;
    - calls `releaseFetchPatchIfOurs()` / `releaseXhrPatchIfOurs()` when no non-disabled source is left. The early source counts as disabled when its scope is disabled.
13. **`transport.ts`**
    - `Transport = (url, json, mode: 'live' | 'unload') => Promise<DeliveryOutcome>`.
    - `DeliveryOutcome = 'delivered' | 'drop' | 'retry' | 'retry_opaque' | 'disabled'`.
    - `live` uses `state.nativeFetch` keepalive, one request at a time. `unload` uses the beacon.
    - `classifyDelivery(status, code)` follows §1. It reads `error.code` from the JSON body on 401/403 and compares against `SDK_KILL_ERROR_CODES` imported from `@nexus/shared/errors`.
14. **`retry-storage.ts` + `retry-queue.ts`**
    - `RetryStorage { get, set (returns false on quota/error), remove }` over localStorage, never falling back to memory.
    - `PersistentRetryQueue` with the §1 bounds:
      - `persist(envelope, attempts)` without `user`, at most once for a `retry_opaque` batch;
      - `drain(send)` under `navigator.locks` or a claim; it increments `replays` and drops at `retryQueueMaxReplays`;
      - prune by TTL and bytes;
      - counters → `stats`.
    - Replays set `client.replay = true` and a fresh `sentAt`.
15. **`remote-config.ts`**
    - `parseRemoteConfig(json: unknown): SdkRemoteConfigWire | null` is a hand-written validator.
    - `RemoteConfigClient.refresh(url, key, client)` follows §1 and posts with `state.nativeFetch` to `resolveConfigUrl(url)`.
    - Its cache goes through `config-cache.ts`.
16. **`wire.ts`.** `BrowserWireBatch` gains `environment?`, `release?` and `client.replay?`. Add `SdkConfigWireRequest` and `SdkRemoteConfigWire`.
17. **Snippets**
    - `next-tracker.tsx`:
      - environment and release from literal `process.env.NEXT_PUBLIC_NEXUS_ENVIRONMENT` / `NEXT_PUBLIC_NEXUS_RELEASE`;
      - propagation is now the default; mention `propagateHeadersTo`;
      - tarball `nexus-react-1.1.0.tgz`;
      - keep its existing data-nexus-tool markup, because the contract test requires tools.
    - `vite-react-tracker.tsx`:
      - `routeTemplate` via `matchRoutes(routes, location)` joined with the basename;
      - a header comment showing `main.tsx` with `import './nexus-early';` as its FIRST import line (that exact text).
    - New `vite-nexus-early.ts`: `import { installNexusEarly } from '@nexus/react/early'; installNexusEarly({ url: import.meta.env.VITE_NEXUS_URL, publishableKey: import.meta.env.VITE_NEXUS_KEY });`
    - New `next-instrumentation-client.ts`: `import { installNexusEarly } from '@nexus/react/early'; installNexusEarly({ url: process.env.NEXT_PUBLIC_NEXUS_URL, publishableKey: process.env.NEXT_PUBLIC_NEXUS_KEY });`
18. **README.** Document:
    - the options;
    - the early entry (Next and Vite recipes, and why the Vite import must come first);
    - XHR;
    - `propagateHeadersTo`, with a CORS warning;
    - retries (replacing "not retried");
    - remote config and the kill switch;
    - `getNexusStats`.

**Tests:**
- `nextRouteTemplate`:
  - scalar, catch-all, optional catch-all undefined;
  - duplicate value → `undefined`;
  - a percent-encoded segment;
  - basePath;
  - `useParams()` returning `null`;
  - a params object whose getter throws → no template, and the host still renders.
- The template is stamped on all four event types.
- Early and tracker share one session id with storage blocked.
- No email-based rotation by header peeks.
- Idle: a header peek after the idle window rotates once, the next event uses the same id, and the old page-view id is NOT sent with the new session.
- XHR:
  - the async flag is preserved when `open` is called with 2 args;
  - a re-opened XHR resets its state;
  - an original `open` that throws (bad URL) throws exactly once and is not re-invoked;
  - an app-set header is not duplicated;
  - an axios-like request through the patch.
- Cross-origin requests are not decorated without the allowlist.
- Both ingest URLs (browser and config) are never decorated.
- A later host fetch wrapper that adds Authorization is NOT seen by our ingest or config requests.
- Retry:
  - 5xx → persisted → replayed with `replay: true` and the same eventId/occurredAt;
  - TTL expiry;
  - byte bound;
  - 400 dropped;
  - opaque failure persisted once;
  - dropped after 3 replays;
  - quota error → `persistFailed++`, and no memory fallback.
- Remote config:
  - a cached disable is honoured synchronously;
  - a network failure keeps the cache;
  - a version regression is ignored;
  - remote config cannot enable propagation.
- Kill: a 403 `BROWSER_INGEST_DISABLED` from the config endpoint, with the early entry installed, makes the NEXT fetch AND XHR undecorated in the same page, restores `window.fetch` if it is still ours, and purges the persisted queue.
- All payloads are validated with `browserIngestBatchSchema`, `sdkConfigRequestSchema` and `sdkRemoteConfigSchema` (zod only in tests).
- The `next.test.tsx` mock provides `useParams`.
- The core.test version equality and empty dependencies still pass.

**Acceptance:**
- No public method throws.
- `dist/early.*` contains no `BrowserTracker`, no `react` and no `registry` code.
- `dist/early.js` is ≤ 8 KiB unminified.
- Record the `dist/index.js` and `next.js` sizes before and after in the notes.
- `sdk:pack` is clean.

**Verify:**
```
npm run typecheck -w @nexus/react && npm test -w @nexus/react && npm run build -w @nexus/react
npm run docs:build && npm run sdk:pack     (sdk:pack also needs P3's packages building)
```

#### P3 `node-sdk-snippets`

**Goal:**
- A4: environment in the server SDKs and snippets.
- The express UUID fix.
- Release from env.
- Per-code reject stats.
- 1.1.0.
- The snippet contract tests, including the React early snippets.

**Files:**
- `packages/node/{package.json, README.md}`
- `packages/node/src/{types.ts, version.ts, index.ts, shared-helpers.ts}`
- `packages/node/src/client/{nexus-client.ts, transport.ts, response-classifier.ts, batch-delivery.ts, nexus-client.test.ts}` and the other tests in `packages/node/src/client/*`
- `packages/node/src/{snippets.contract.test.ts, snippets-payload.contract.test.ts}`
- `packages/express/{package.json, README.md}`
- `packages/express/src/{index.ts, middleware.ts, fields.ts, types.ts, middleware.test.ts, contract.test.ts}`
- `docs/snippets/{express-esm.ts, express-cjs.js, fastapi_nexus_asgi.py, curl.sh, nestjs.main.ts}`

**Steps:**
1. **Environment option.**
   - `NexusClientOptions.environment?: NexusEnvironment`, a literal union with a two-way assertion test against `ENVIRONMENT_VALUES`.
   - `resolveSettings`: option ?? `process.env.NEXUS_ENVIRONMENT`. An invalid value is omitted, with a throttled `Diagnostics.warn('environment', …)`.
   - `TransportConfig.environment?`. `IngestTransport.envelope()` emits `environment` ONLY when it is set. Add `NexusServerBatch.environment?`.
2. **`shared-helpers.ts`:** `IngestEndpoint = 'server' | 'browser' | 'verify' | 'config'`.
3. **Per-code reject stats** in `response-classifier.ts` / `batch-delivery.ts`.
   - Count `rejected[].code` per code (codes only).
   - `NexusClientStats.rejectedByCode: Partial<Record<string, number>>`.
   - The diagnostic names the code.
4. **Version 1.1.0** in `package.json`, `version.ts`, `EXPRESS_SDK` and the test literals.
5. **express `fields.ts`:** strict RFC `UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`. Test: a malformed header is dropped and the event is kept.
6. **express `middleware.ts` `settingsOf`:** `release: options.release ?? process.env.NEXUS_RELEASE`, bounded.
7. **Snippets.**
   - Each gets an `environment` option, defaulting to `NEXUS_ENVIRONMENT`, sent only when valid.
   - Python:
     - the `body` literal names `"environment": self._environment`, then strips None (`{k: v for k, v in body.items() if v is not None}`);
     - `NexusClient(url, key, *, environment=None, sdk_name=…, sdk_version="1.1.0")`.
   - `curl.sh` adds `"environment": "prod"`.
   - Header comments state LOUDLY that `getUser` defaults to anonymous, and how to wire it (A3).
8. **`snippets-payload.contract.test.ts`.**
   - Do NOT add rows to the existing React `describe.each`: it needs tools.
   - Add a separate `describe('next-instrumentation-client.ts')`: `importedNames(source, '@nexus/react/early')` is non-empty, contains `installNexusEarly`, and ⊆ `exportedNames(readFileSync(path.join(REACT_SRC, 'early.ts')))`.
   - Add the same kind of `describe('vite-nexus-early.ts')`.
   - Add a test that `vite-react-tracker.tsx` contains the line `import './nexus-early';`.
   - The FastAPI exact-keys test now includes `environment`.

**Tests:**
- The envelope emits environment only when set.
- Env fallback.
- An invalid value is omitted.
- `rejectedByCode`.
- UUID strictness.
- The release env default.
- Snippet payloads parse with `serverIngestBatchSchema`.

**Verify** (the node contract tests run after P2 has landed `early.ts` and the two new snippets):
```
npm run typecheck -w @nexus/node && npm run typecheck -w @nexus/express && npm run build -w @nexus/node && npm test -w @nexus/node && npm test -w @nexus/express
```

#### P4 `api-ingest` (also owns API composition: `container.ts`, `routes/index.ts`)

**Goal:**
- A1: template guard.
- A3: SSO outcome capture and replay.
- A4: environment resolution and storage.
- A5: tz/lang/release storage.
- A7: public config endpoint, pre-auth CORS, config limiter, IP-failure rule.
- A8: scrubber and counters.
- A9: rejection capture.
- Prod-only LiveFeed.
- Aggregate retention (service + repository).
- Registering ALL new routes.

**Files:**
- `apps/api/src/http/routes/index.ts`, `apps/api/src/container.ts`
- `apps/api/src/http/types/express.d.ts`: add `errorCode?: ErrorCode` to Locals.
- `apps/api/src/http/cache-control.ts`: add `NO_STORE_CACHE = 'no-store'`.
- `apps/api/src/http/controllers/{ingest.controller.ts, ingest.controller.test.ts}`
- `apps/api/src/http/middleware/`:
  - `ingest-auth.middleware.ts` (+test)
  - `error-handler.middleware.ts` (+test)
  - `rate-limit.middleware.ts` (+test)
  - `browser-ingest-cors.middleware.ts` (+test)
  - new `rejection-recorder.middleware.ts` (+test)
- new `apps/api/src/auth/allowed-origin.cache.ts` (+test)
- `apps/api/src/auth/sso-identity.reader.ts`, new `apps/api/src/auth/sso-outcome.test.ts`
- `apps/api/src/services/{ingest.service.ts, ingest.service.test.ts, ingest.service.integration.test.ts}`, new `apps/api/src/services/aggregate-retention.service.ts` (+test)
- `apps/api/src/domain/{viewer.ts, inserts.ts, to-api-request-insert.ts, to-api-request-insert.test.ts, to-web-event-insert.ts, to-web-event-insert.test.ts, browser-sdk.ts}`
- new `apps/api/src/domain/{environment.ts, schema-path.ts, route-template.ts, sdk-config.ts, sdk-label.ts}`, each with a `.test.ts`
- `apps/api/src/enrichment/{server-event.enricher.ts, browser-event.enricher.ts, identity.resolver.ts}` (+ their tests), new `apps/api/src/enrichment/pii.scrubber.ts` (+test)
- `apps/api/src/repositories/{api-request-ingest.repository.ts, web-event-ingest.repository.ts}` (+tests)
- new `apps/api/src/repositories/{ingest-rejection.repository.ts, pii-detection.repository.ts, sso-cookie-outcome.repository.ts, aggregate-retention.repository.ts}`
- `apps/api/src/jobs/retention.job.ts` (+test)
- `apps/api/src/live/live-feed.ts`, new `apps/api/src/live/live-feed.test.ts`
- Test fixtures:
  - `apps/api/test/ingest-fixtures.ts`: its own `appRow()` gains `sdk_config_version: 1, sdk_disabled_modules: [], sdk_config_updated_at: null`
  - `apps/api/test/db/fixtures.ts`
  - `apps/api/test/fixtures/live-inserts.ts`
- Integration tests:
  - `apps/api/test/e2e/ingest.integration.test.ts`
  - `apps/api/test/db/repositories.integration.test.ts`
  - `apps/api/test/db/retention-job.integration.test.ts`
  - `apps/api/test/routes-contract.test.ts` (only if needed)
  - `apps/api/test/security/security.test.ts`
  - `apps/api/test/security/security.integration.test.ts` (if affected)

**Steps:**
1. **`viewer.ts`**
   - `IngestContext.environmentClaim: string | null`.
   - `BrowserIngestContext.envelope: {release?, tz?, lang?, replay: boolean}`.
   - `BrowserRequestInfo.origin: string | null`, taken from `requestOrigin`. Never store the referer path.
2. **`domain/environment.ts`:** `resolveEnvironment(claim, origin, source): {environment: Environment; droppedClaim: boolean}`. Also exports `isLoopbackHost(host)`.
3. **`domain/route-template.ts`:** `isPlausibleRouteTemplate(template, path, basePath): boolean`.
4. **`domain/sdk-label.ts`:** `normalizeSdkLabel(raw: string | null | undefined): string`, per §1. It returns `''` when the label is invalid.
5. **`enrichment/pii.scrubber.ts`**
   - `export class PiiScrubber { scrubPathLike(field, value): ScrubResult; scrubText(field, value): ScrubResult; scrubIdentifier(field, value): ScrubResult; scrubStoredPathSegments(field: 'path' | 'referrer_path', value): ScrubResult }`.
   - `ScrubResult { value: string; kinds: PiiKind[] }`.
   - Patterns are compiled once, with the checksum post-filters.
   - The enrichers apply the per-field policy and return `piiFindings: PiiFinding[]` (`{field, kind}`), deduplicated per (field, kind) per event.
6. **Enrichers**
   - **`ServerEventEnricher`:**
     1. Scrub path, routeTemplate, errorCode, requestId and release.
     2. `RouteNormalizer` and `toEndpointId`.
     3. `scrubStoredPathSegments('path', …)` on the stored path.
   - **`BrowserEventEnricher.enrich`:**
     1. Sanitize.
     2. Template plausibility.
     3. Scrub path, referrerPath, routeTemplate, label, props (keys and values), tool and name.
     4. Normalize and ids.
     5. `scrubStoredPathSegments` on path and referrerPath.
   - **`enrichActor`** passes `{replay}` to `IdentityResolver.forBrowser`.
     - `ResolvedIdentity.ssoOutcome: SsoCookieOutcome | null` (null on replay).
     - An ok cookie with an implausible email gives `'no-email'`.
   - **`SsoIdentityReader`:** the failure branch is typed `{ok:false; reason: CookieFailureReason}`.
7. **Mappers and inserts**
   - `ApiRequestInsert.environment` and `WebEventInsert.{environment, clientTz, clientLang, release}` are required (nullable where the column is).
   - The `COLUMNS` arrays gain them.
   - tz and lang are validated with the CLIENT_* patterns.
   - Envelope warnings go on the first stored event.
8. **`IngestService`**
   - Collect a `RejectionIncrement {source, sdk: normalizeSdkLabel(ctx.sdk), code, schemaPath}` at every reject site, capped.
   - Collect PII increments.
   - After commit, and not on dryRun, each step in its own try/catch + `logger.warn`:
     - `IngestRejectionRepository.increment(appId, rows, at)`
     - `PiiDetectionRepository.increment(appId, source, rows, at)`
     - `SsoCookieOutcomeRepository.increment(appId, outcome, beaconOrigin, at)`: browser only, once per batch, skipped for replays.
   - `beaconOrigin` is computed against `new URL(env.PUBLIC_ORIGIN).origin`; PUBLIC_ORIGIN is injected from the container.
   - `config(app: AppRow): SdkRemoteConfig` delegates to `toSdkRemoteConfig(app)`.
9. **Counter repositories.** Each follows the `IngestCounterRepository.increment` pattern:
   - IST hour bucket via `bucketExpr('hour', '$n::timestamptz')`;
   - an additive `ON CONFLICT` upsert;
   - the WRITE pool;
   - `@see` the migration;
   - multi-row `unnest`.
10. **Error locals and rejection recorder**
    - `errorHandlerMiddleware` sets `res.locals.errorCode = body.error.code` BEFORE it sends.
    - `rejectionRecorderMiddleware(repo, source)` is mounted ONLY on POST `ingest.server` (right after `serverKeyAuth`) and POST `ingest.browser` (right after `publishableKeyAuth`).
    - On `finish`, it records when: status ≥ 400, `res.locals.ingest?.app` is set, and `errorCode ∈ {INVALID_ENVELOPE, ORIGIN_NOT_ALLOWED}`.
      - `schemaPath` is `''`.
      - `sdk` is `''` for ORIGIN_NOT_ALLOWED, else `normalizeSdkLabel(...)`.
11. **`rate-limit.middleware.ts`:** in `ipFailureLimitMiddleware`, `requestWasSuccessful = !(status ∈ {401,403} && KEY_GUESS_ERROR_CODES.includes(res.locals.errorCode))`.
12. **`allowed-origin.cache.ts` + `browser-ingest-cors.middleware.ts`**
    - `AllowedOriginCache { allows(origin): Promise<boolean> }`: LRU of 500, TTL 30 s, negatives cached.
    - `browserIngestPreflightMiddleware(origins: AllowedOriginCache)` replaces its direct repository use.
    - New `browserIngestEarlyCorsMiddleware(origins: AllowedOriginCache)`, per §1.
13. **`ingest-auth.middleware.ts`:** `publishableKeyAuth` becomes generic over a validated body `{key: string; client?: {sdk: string; version: string}}`.
14. **`IngestController.config`:** `res.status(200).set(CACHE_CONTROL_HEADER, NO_STORE_CACHE).json(this.ingest.config(requireIngest(res).app))`.
15. **Routes (`routes/index.ts`)**
    ```
    // browser chain gains mw.browserIngestEarlyCors FIRST and mw.browserRejectionRecorder after publishableKeyAuth;
    // server chain gains mw.serverRejectionRecorder after serverKeyAuth.
    r.use(ROUTES.ingest.config.path, mw.browserIngestPreflight);
    r.post(ROUTES.ingest.config.path, mw.browserIngestEarlyCors, mw.browserIpFailureLimit, mw.beaconBody, mw.parseBeaconJson,
      validateBody(sdkConfigRequestSchema, ERROR_CODES.INVALID_ENVELOPE), mw.publishableKeyAuth, mw.browserIngestCors,
      mw.originGuard, mw.browserConfigRateLimit, ctl.ingest.config);
    r.patch(ROUTES.apps.updateSdkConfig.path, ...admin, mw.dashboardJsonBody, validateParams(appSlugParamsSchema),
      validateBody(updateSdkConfigBodySchema), ctl.apps.updateSdkConfig);
    r.get(ROUTES.overview.breakdown.path, ...dashboard, validateQuery(breakdownOverviewQuerySchema), ctl.overview.breakdown);
    r.get(ROUTES.overview.devices.path, ...dashboard, validateQuery(devicesOverviewQuerySchema), ctl.overview.devices);
    ```
    The controller is always last.
16. **`container.ts`.** Construct:
    - `PiiScrubber`, `AllowedOriginCache`;
    - the 3 counter repositories (write pool), `AggregateRetentionRepository`, `AggregateRetentionService`;
    - `browserConfigRateLimit` (a separate `keyRateLimitMiddleware` instance with the browser key budget and `() => {}` as onLimited);
    - `browserIngestEarlyCors`;
    - the two recorders.

    Wire them into the enrichers, `IngestService`, the middleware and `RetentionJob`. P5 adds no constructor dependencies.
17. **LiveFeed:** `recordApiRequests` and `recordWebEvents` keep only `environment === 'prod'` (new `live-feed.test.ts`).
18. **Retention:** `RetentionJob` calls `this.aggregates.deleteExpired(client)` inside the same advisory-lock callback, after `partitions.dropExpired`. The repository runs three `DELETE … WHERE bucket_hour < $1` statements, with cutoff = now − `AGGREGATE_RETENTION_DAYS`.
19. **`sso-outcome.test.ts`:** a compile-time two-way equality test between `SsoCookieOutcome` and `'ok' | CookieFailureReason`.
20. **`security.test.ts`:**
    - The expected admin mutations become `['create','createKey','expireKey','revokeKey','update','updateSdkConfig']`.
    - Send a valid `updateSdkConfigBodySchema` body (e.g. `{expectedVersion: 1, disabledModules: []}`) so the CSRF, admin and no-cookie cases reach the guards.

**Tests:**
- The environment matrix (a localhost origin overrides a `prod` claim).
- The template guard.
- PII true and false positives through the enrichers, including `/customers/9876543210` → stored `/customers/:phone`, with the endpoint/page id unchanged versus `/customers/1234567890`.
- Warnings: FIELD_REDACTED and FIELD_DROPPED.
- Reject reasons are persisted without messages (e2e asserts no message text); a 300-char `X-Nexus-SDK` header gives an `''` row and the upsert succeeds.
- A replay skips the cookie identity.
- The config endpoint:
  - 200 with version and modules;
  - a cross-origin 403 `BROWSER_INGEST_DISABLED`, 401 `INVALID_API_KEY` and 400 `INVALID_ENVELOPE` all carry ACAO and ACAC for a registered origin, and none for an unregistered one;
  - no preflight is needed;
  - config polls do not touch `ingest_counters.rate_limited`.
- N kill-switch 403s from one IP do not 429 another app's valid beacon.
- LiveFeed ignores dev.
- Retention deletes old aggregates.
- The counter repositories work in `repositories.integration.test.ts`.

**Verify** (the joint api gate, run with P5 landed; before that, scoped vitest only):
```
npx vitest run <P4 files>   (cwd apps/api)
npm run typecheck -w @nexus/api && npm test -w @nexus/api
npm run test:db -w @nexus/api -- test/e2e/ingest.integration.test.ts src/services/ingest.service.integration.test.ts test/db/retention-job.integration.test.ts test/db/repositories.integration.test.ts test/security/security.integration.test.ts
```

#### P5 `api-read-admin`

**Goal:**
- A4: the environment filter across all reads.
- A5: the breakdown and devices endpoints.
- A2/A3/A9/A10: the Integration Health additions and the level.
- A7: the admin config update.

**FIRST deliverable**, before anything else:
- `AppController.updateSdkConfig`, `OverviewController.breakdown`, `OverviewController.devices` (arrow properties);
- the service method signatures: `AppAdminService.updateSdkConfig`, `OverviewService.breakdown` / `devices`. Bodies may throw temporarily.

**Files:**
- `apps/api/src/domain/{filters.ts, rows.ts, mappers.ts, mappers.test.ts, integration-health.ts (+test)}`
- `apps/api/src/services/`:
  - `query-window.ts` (+test), `overview.service.ts` (+test), `integration.service.ts` (+test), `live.service.ts` (+test)
  - `endpoint.service.ts`, `error.service.ts`, `geo.service.ts`, `journey.service.ts`, `page.service.ts`, `tool.service.ts`, `user.service.ts`, plus their existing tests
  - `app-admin.service.ts` (+test), `app-query.service.ts` (+test)
- `apps/api/src/http/controllers/{overview.controller.ts (+test if one exists), app.controller.ts (+test), integration.controller.test.ts}`
- `apps/api/src/repositories/{api-request-query.repository.ts, web-event-query.repository.ts, ingest-health.repository.ts, app.repository.ts}` (+tests), new `apps/api/src/repositories/coverage-predicates.ts` (+test)
- `apps/api/test/fixtures/{fake-query-repositories.ts, app-rows.ts, analytics-rows.ts}`
- `apps/api/test/db/{analytics-queries.integration.test.ts, ingest-health.integration.test.ts, analytics-seed.ts}`, new `apps/api/test/db/app-sdk-config.integration.test.ts`
- `apps/api/test/e2e/dashboard.integration.test.ts`

**Steps:**
1. **Filter plumbing**
   - `TrafficFilter.environments: readonly Environment[] | null` is required; `null` means all.
   - `environmentsOf(env?: EnvironmentFilter)`: `undefined` / `'prod'` → `['prod']`; `'all'` → `null`; anything else → `[env]`.
   - `currentFilter(window, appId, environments)` / `previousFilter(…)`. Update every call site, plus the hand-built filters in `overview.service.ts` (activeWindow) and `live.service.ts` (always `['prod']`).
2. **Predicates**
   - `windowConditions` and `scopeConditions` add `${alias}.environment = ANY($n::text[])` when the filter has environments.
   - Patch the hand-built ones: `listPageApiCalls` (both tables), `listOnlineUsers` pageWindow (prod), `countOnlineByApp` (prod), `pageViewVisibleMs`.
   - Audit every UNION statement in `web-event-query.repository.ts`, and add a unit test that every exported statement builder emits the predicate.
3. **`coverage-predicates.ts`**
   - `IDENTIFIED_SQL(alias)`, `LINKABLE_SQL(alias)`, `LINKED_SQL(alias)`, `PAGE_VIEW_LINKED_SQL(alias)`.
   - The literals come from `const HTTP_KIND: ServerEventKind = 'http'` and `LINKABLE_DEVICE_CLASSES`.
   - Consumers:
     - `summarizeActivityByApp`: `IDENTIFIED_SQL`, combined sources;
     - `summarizeTrafficByApp`: `LINKABLE` / `LINKED`, and it also returns `linkable`;
     - `mapAppTraffic`: `linkedPct = linked / linkable`;
     - `sdkHealthSql`.
   - A unit test asserts `LINKABLE_DEVICE_CLASSES` ⊆ the api `DEVICE_CLASSES`.
4. **Breakdown and devices**
   - `WebEventQueryRepository.countByDimension(dim, filter, limit)`:
     - a frozen `BREAKDOWN_COLUMNS satisfies Record<BreakdownDimension,string>`;
     - page_view rows, except `time_reason`, which reads page_time rows;
     - `count(*) OVER ()` for the total.
   - `ApiRequestQueryRepository.countByDimension(dim: ServerBreakdownDimension, …)`.
   - `WebEventQueryRepository.countDeviceReturn(filter, lookbackFrom)`, with both windows bounded.
   - `OverviewService.breakdown` / `devices` via `resolveQueryWindow(query, now, MAX_COUNT_RANGE_MS)`.
   - The controllers read input with `validQuery(res, schema)` and set `DASHBOARD_ANALYTICS_CACHE`.
5. **Integration Health**
   - `sdkHealthSql` adds `identified`, `linked`, `page_view_linked`, `linkable` (constant 0 for web_events), `with_release` and `latest_release`.
   - New exported SQL statements:
     - `ENVIRONMENT_MIX_SQL`
     - `REJECTION_REASONS_SQL`, `PII_DETECTIONS_SQL`, `SSO_COOKIE_OUTCOMES_SQL`, each bounded by `bucket_hour >= bucketExpr('hour', $1)`
   - `perApp` runs them in its `Promise.all`. `IngestHealthRows` gains `environmentMix`, `rejections`, `piiDetections` and `ssoOutcomes`.
   - Row types and pure functions: `identityCoverageOf`, `linkingCoverageOf`, `releaseStatusOf`, `integrationLevelOf`, `WARNING_RULES.pii_detected`.
   - Mappers map `''` → `null`, and `mapSdkHealth` splits name and version.
   - Update `ingest-health.repository.test.ts`, the EMPTY rows in `integration.service.test.ts`, and the DB test's expected warnings and level.
6. **Admin config**
   - `AppRow` gains the 3 fields. Add them to `APP_COLUMNS`, `mapApp` → `sdkConfig`, and the `app-rows.ts` `appRow()` defaults.
   - `AppRepository.updateSdkConfig(appId, disabledModules, expectedVersion, exec): Promise<AppRow | null>` runs the conditional UPDATE … RETURNING.
   - **`AppAdminService.updateSdkConfig(slug: string, body: UpdateSdkConfigBody, actor: Viewer): Promise<AppDto>`**, in a `withTransaction`:
     1. `requireApp`;
     2. the repository update (null → `ConflictError` CONFLICT);
     3. `apiKeys.listByAppIds([app.id], client)`;
     4. audit `'APP_SDK_CONFIG_UPDATE'`, `'app'`, `{slug, version, disabledModules}`.

     After COMMIT, call `keyCache.invalidateApp(app.id)` and return `mapApp(app, keys)`.
   - `AppController.updateSdkConfig`: `this.appAdmin.updateSdkConfig(validParams(res, appSlugParamsSchema).slug, validBody(res, updateSdkConfigBodySchema), requireViewer(res))`.
7. **Fixtures**
   - `fake-query-repositories.ts`: add the new methods to the `Pick<>` lists.
   - `analytics-rows.ts`: the new row factories.
   - `analytics-seed.ts`: the new insert fields from P4 (environment `'prod'` default, nulls), plus seed rows for non-prod data, ua/tz/lang/release values and repeated `anonymous_id`s.
   - `mappers.test.ts`: the `AppDto.sdkConfig` and `SdkHealthDto` name/version expectations.

**Verify** (the joint api gate):
```
npx vitest run <P5 files>   (cwd apps/api)
npm run typecheck -w @nexus/api && npm test -w @nexus/api
npm run test:db -w @nexus/api -- test/db/analytics-queries.integration.test.ts test/db/ingest-health.integration.test.ts test/db/app-sdk-config.integration.test.ts test/e2e/dashboard.integration.test.ts
```

#### P6 `web`

**Goal:** the environment filter UI, breakdown panels, the Integration Health panels and level, the remote-config editor, guide chapters and copy.

**Files** (under `apps/web/src`):
- `lib/{api.ts, api.test.ts, guide.ts, metricCopy.ts, metricCopy.test.ts, nav.ts, pages.ts (if needed)}`, `lib/query/{keys.ts, keys.test.ts}`
- `features/filters/{useGlobalFilters.ts, useGlobalFilters.test.ts}`, new `features/filters/EnvironmentSelect.tsx` (+test)
- `components/AppShell.tsx`, new `components/CoverageValue.tsx`, new `components/SwitchRow.tsx`
- `features/applications/{appTrafficColumns.tsx, ApplicationDetailView.tsx, ApplicationsView.test.tsx}`, new `features/applications/ApplicationAudienceSection.tsx`
- new `features/breakdowns/{useBreakdown.ts, useDeviceReturn.ts, BreakdownPanel.tsx, DeviceReturnPanel.tsx, breakdownCopy.ts}` + tests
- `features/integration/{AppHealthCard.tsx, integrationCopy.ts, IntegrationView.tsx, IntegrationView.test.tsx}`, new `features/integration/{CoverageStats.tsx, EnvironmentMix.tsx, ReleaseStatus.tsx, RejectionsTable.tsx, PiiDetectionsTable.tsx, SsoOutcomes.tsx, IntegrationLevelBadge.tsx}`
- `features/apps/{AppCard.tsx, AppsView.tsx, AppFormDialog.tsx (uses components/SwitchRow), appForm.ts, appForm.test.ts, useAppMutations.ts, AppsView.test.tsx}`, new `features/apps/RemoteConfigDialog.tsx`
- `test/{adminFixtures.ts, fixtures.ts}`

**Steps:**
1. **API client:** `api.apps.updateSdkConfig(slug, body)`, `api.overview.breakdown(q)`, `api.overview.devices(q)`, plus `qk.overview.breakdown(q)` and `qk.overview.devices(q)`.
2. **Environment filter**
   - `globalFilterParsers.env = parseAsStringLiteral(ENVIRONMENT_FILTER_VALUES)`.
   - `toTimeWindowQuery` keeps `env` in BOTH fallbacks.
   - `filterLinkQuery` carries `env` unless it is absent or `'prod'`.
   - Add `setEnvironment`.
   - `PageFilters.environment: boolean`: true for COUNT/PERCENTILE pages; false for live, integration and apps.
   - `EnvironmentSelect` (`aria-label="Environment filter"`, default label "Production") goes in `TopBar`.
3. **Breakdowns**
   - `BreakdownPanel` and `DeviceReturnPanel`. Ingested values are rendered as TEXT only.
   - `ApplicationAudienceSection` goes in a new grid row of ApplicationDetailView.
   - The "Integration health" link becomes `withQuery(PAGES.integration(), {app})`.
4. **Integration**
   - The new blocks are composed in `AppHealthCard`.
   - Add an SDK version column.
   - `LEVEL_COPY`.
   - `WARNING_COPY.pii_detected` (chapter `pii`).
   - `SSO_OUTCOME_COPY: Record<SsoCookieOutcome,string>`. For example:
     - no-cookie → cookie Path/Domain/SameSite, or the user is signed out;
     - bad-signature → LIBAS_JWT_SECRET mismatch.
   - `REJECTION_CODE_COPY` for the 6 codes.
   - A 5th `TallyGrid` KPI, "Fully integrated".
   - Identity copy: "Applications = both sources combined; this page = per source".
5. **Guide:** `GUIDE_CHAPTERS` gains `serverContract:'02-server-contract'`, `browserContract:'03-browser-contract'`, `pii:'05-pii'`, `userEmail:'07-user-email'`, `environments:'09-environments'`.
6. **Copy**
   - New `metricCopy` keys.
   - The `linkedPct` copy uses the new denominator.
   - `COVERAGE_WARN_PCT = COVERAGE_TARGET_RATIO * 100`.
   - Lift `CoverageCell` into `components/CoverageValue.tsx`.
   - Update the assertions in `metricCopy.test.ts` and `ApplicationsView.test.tsx`.
7. **Remote config**
   - `RemoteConfigDialog`: a module checklist plus `expectedVersion`; CONFLICT is shown via `InlineError`; success via `toast.success`.
   - The kill switch toggles `browserIngestEnabled` via `useUpdateApp`.
   - `sdkConfigFormOf` / `toUpdateSdkConfigBody` in `appForm.ts`, tested in `appForm.test.ts`.
   - `useUpdateSdkConfig` uses `useInvalidateApps()`.
   - AppCard gets a "Remote config" Detail row and an "Edit remote config" button.
8. **Fixtures:** `ADMIN_APPS` / `APPS` gain `sdkConfig`; `appHealth()` gains all the new fields.

**Verify:**
```
npm run typecheck -w @nexus/web && npm test -w @nexus/web
```

---

### WAVE 2 checkpoint (lead, no file ownership)
```
npm run build:shared && npm run build -w @nexus/node
npm run typecheck && npm test
npm run test:db
npm run openapi:emit -- --check && npm run env:example -- --check && npm run docs:build && npm run sdk:pack
```
- No new env vars are introduced, so env:example stays clean.
- Do not start Wave 3 until everything is green.
- Expected output: `docs/dist/files/sdk/nexus-react-1.1.0.tgz`, plus the node and express tarballs.

---

### WAVE 3 (parallel: P7, P8)

#### P7 `ebo-sales` (in `D:\server\EBO_SALES`; leave UNCOMMITTED)

**Files:**
- `frontend/vendor/nexus-react-1.1.0.tgz` (new; delete `nexus-react-1.0.0.tgz`)
- `frontend/package.json` and `frontend/package-lock.json`, via `npm install file:vendor/nexus-react-1.1.0.tgz`
- new `frontend/src/instrumentation-client.ts`
- `frontend/src/lib/traffic/config.ts`, `frontend/src/components/traffic/traffic-tracker.tsx`, `frontend/src/lib/api/client.ts` (comment only)
- `frontend/Dockerfile`, `frontend/.env.example`, `docker-compose.yml`, `deploy.sh`, `deploy.ps1`
- `backend/app/core/{nexus_asgi.py, traffic_monitoring.py, config.py}`, `backend/.env.example`, `backend/tests/test_traffic_monitoring.py`
- `docs/NEXUS_TRAFFIC.md`

**Steps:**
1. **`config.ts`**
   - `TRAFFIC_MONITORING.environment`: literal `process.env.NEXT_PUBLIC_NEXUS_ENVIRONMENT`, validated as `prod|staging|dev`. Default: `NODE_ENV === 'production' ? 'prod' : 'dev'`.
   - `TRAFFIC_MONITORING.release`: literal `process.env.NEXT_PUBLIC_NEXUS_RELEASE`, else `undefined`.
2. **`instrumentation-client.ts`:** `if (TRAFFIC_MONITORING.enabled) installNexusEarly({ url: TRAFFIC_MONITORING.url, publishableKey: TRAFFIC_MONITORING.publishableKey })`.
3. **`traffic-tracker.tsx`:** pass `environment` and `release`, keep `propagateHeaders`, update the doc comment. No routeTemplate prop is needed: the routes are static.
4. **Backend**
   - `Settings.nexus_environment: str = ""` plus `nexus_effective_environment` (blank → `local→dev`, `staging→staging`, `production→prod`).
   - Re-vendor `nexus_asgi.py` from the updated snippet, then `ruff format`.
   - `NexusClient(url, key, environment=…)`.
   - Add pytest cases for the environment, the release and the mapping.
5. **Build and deploy**
   - Dockerfile: `ARG`/`ENV NEXT_PUBLIC_NEXUS_ENVIRONMENT` and `NEXT_PUBLIC_NEXUS_RELEASE`.
   - compose web build args: `NEXT_PUBLIC_NEXUS_ENVIRONMENT: ${NEXUS_ENVIRONMENT:-prod}`, `NEXT_PUBLIC_NEXUS_RELEASE: ${NEXUS_RELEASE:-}`.
   - compose api env: `NEXUS_RELEASE: ${NEXUS_RELEASE:-}`. Note: this overrides `backend/.env`; it is documented.
   - `deploy.sh`: `export NEXUS_RELEASE=$(git rev-parse --short HEAD)`. `deploy.ps1`: `$env:NEXUS_RELEASE = git rev-parse --short HEAD`.
6. **`docs/NEXUS_TRAFFIC.md`:** the settings tables, instrumentation-client, the tarball name, and the fact that the CSV export can never be linked.

**Verify:**
```
cd backend; .venv\Scripts\ruff.exe format --check app; .venv\Scripts\ruff.exe check app; .venv\Scripts\mypy.exe app
$env:DB_HOST='localhost'; $env:DB_USER='ci'; $env:DB_PASSWORD='ci'; $env:DB_NAME='ci'; .venv\Scripts\pytest.exe -q --ignore=tests/test_live_isolation.py
cd frontend; npm ci; npm run lint; npx tsc --noEmit; npm run build
```

**Manual check** against a local Nexus:
- The first-load `/api/v1/*` requests carry `X-Nexus-Session` and `X-Nexus-Page-View`.
- Batches carry `environment:'dev'`, `release` and `routeTemplate`.
- The config POST returns 200.
- The dashboard default (prod) hides this traffic.

#### P8 `docs-ai-context`

**Files:**
- `docs/integration/{00-overview, 01-getting-keys, 02-server-contract, 03-browser-contract, 04-responses-retries, 05-pii, 07-user-email, 08-recipes, 09-environments, 10-verify, 11-troubleshooting, appendix-per-app-hints}.md`
- `docs/CHANGELOG.md`, `scripts/build-docs.ts` (TOKENS), `apps/api/test/docs-build.test.ts` (if TOKENS tests need rows)
- `ai-context/decisions/0008…0013` (new)
- `ai-context/{PROGRESS.md, 02-architecture.md, 03-code-navigation.md, 04-how-to-recipes.md, 07-data-model.md, 08-integration-contract.md, 09-local-development.md, GLOSSARY.md, README.md (if the reading order changes)}`

**Steps:**
1. **Guide.** Fix the stale text (00 l.11-14, 03 l.10-12, 08 l.120-140, 01 l.29-33, 09 l.14-21 and 75-92). Cover:
   - environment: the envelope table, the resolution rules, and that `-dev` apps are still allowed;
   - browser release;
   - routeTemplate syntax for Next and React Router;
   - the early entry: Next instrumentation-client, and Vite's first-import module (with the ESM hoisting explanation);
   - XHR, and `propagateHeadersTo` with a CORS warning;
   - the retry queue: replay identity and the replay cap;
   - remote config and the kill switch, including "cross-origin collectors: error responses are readable for registered origins";
   - PII: two passes, the segment scrub, FIELD_REDACTED;
   - SSO cookie requirements (Path=/, a Domain covering the collector, SameSite for cross-site) and the getUser guidance;
   - the Integration page panels and the level;
   - troubleshooting rows.
2. **TOKENS** are derived from shared constants (`{{ENVIRONMENT_VALUES}}`, `{{SDK_RETRY_QUEUE_TTL}}`, `{{SDK_RETRY_MAX_REPLAYS}}`, `{{SDK_CONFIG_MAX_AGE}}`, `{{COVERAGE_TARGET}}`, `{{AGGREGATE_RETENTION_DAYS}}`, `{{PII_KINDS}}`).
3. **CHANGELOG**, under "v1 additive — 2026-11":
   - envelope `environment` (both envelopes), browser `release`, `client.replay`;
   - FIELD_REDACTED and the stored-path segment scrub;
   - `POST /v1/ingest/config`;
   - pre-auth CORS on browser errors;
   - the IP-failure-limiter rule;
   - the page-id cut-over;
   - SDK 1.1.0.
4. **ADRs 0008–0013** (§1).
5. **ai-context**
   - `02-architecture`: the new public route, the tables and the CORS layering.
   - `07-data-model`: the new columns, tables and index, the BRIN verdict; remove "no environment column".
   - `04-how-to-recipes`: the grant-list correction.
   - `08-integration-contract`, `03-code-navigation` (the new chains, including the retention service), `09-local-development` (localhost traffic resolves to `dev` and is hidden by default; use `env=all`), `GLOSSARY`.
   - The PROGRESS entry for Phase A.
   - Reference only repo paths that exist.

**Verify:**
```
npm run docs:build && npx vitest run test/docs-build.test.ts test/ai-context-links.test.ts   (cwd apps/api)
```

**FINAL gate (lead):**
1. The Wave 2 checkpoint commands again, plus the EBO verify.
2. Then the single commit (§0.4).

---

## 4. Cross-package interfaces (exact names)

**Shared (P1 → everyone):** every name in §2, verbatim.

**P4 ↔ P5 (api)**
- **AppRow fields:** `AppRow.sdk_config_version: number`, `sdk_disabled_modules: SdkCaptureModule[]`, `sdk_config_updated_at: Date | null`.
  - P5 defines them in `rows.ts` and in `test/fixtures/app-rows.ts`.
  - P4 reads them in `domain/sdk-config.ts` `toSdkRemoteConfig(app: AppRow): SdkRemoteConfig`, and adds the same three defaults to its own `appRow()` in `test/ingest-fixtures.ts`.
- **Controllers** (registered by P4, implemented by P5; P5 delivers them first):
  - `AppController.updateSdkConfig`
  - `OverviewController.breakdown`
  - `OverviewController.devices`

  All are arrow properties `(req, res) => Promise<void>`. They read input via `validQuery(res, schema)` / `validBody(res, schema)` / `validParams(res, schema)` from `http/request-accessors.ts`, and the actor via `requireViewer(res)`.
- **Services (P5):**
  - `AppAdminService.updateSdkConfig(slug: string, body: UpdateSdkConfigBody, actor: Viewer): Promise<AppDto>`
  - `OverviewService.breakdown(query: BreakdownOverviewQuery): Promise<BreakdownDto>`
  - `OverviewService.devices(query: DevicesOverviewQuery): Promise<DeviceReturnDto>`

  No new constructor parameters.
- **Insert types (P4, `inserts.ts`):**
  - `ApiRequestInsert.environment: Environment`
  - `WebEventInsert.environment: Environment`, `clientTz: string | null`, `clientLang: string | null`, `release: string | null`

  P5 adds the same fields in `analytics-seed.ts` and `analytics-rows.ts`, and reads the columns `environment`, `client_tz`, `client_lang`, `release`.
- **Tables written by P4, read by P5:**
  - `traffic.ingest_rejections(app_id, source, sdk, code, schema_path, bucket_hour, rejected)`
  - `traffic.pii_detections(app_id, source, field, kind, bucket_hour, detections)`
  - `traffic.sso_cookie_outcomes(app_id, outcome, beacon_origin, bucket_hour, beacons)`

  `''` means "none", and P5 maps it to `null`.
- **Locals (P4, `express.d.ts`):** `res.locals.errorCode?: ErrorCode`, set by `errorHandlerMiddleware`.

**P2 ↔ P3**
- `packages/react/src/early.ts` exports exactly `installNexusEarly` and `NexusEarlyOptions`.
- `docs/snippets/next-instrumentation-client.ts` and `docs/snippets/vite-nexus-early.ts` import only `installNexusEarly` from `@nexus/react/early`.
- `docs/snippets/vite-react-tracker.tsx` contains the literal line `import './nexus-early';` and keeps its tool markup.
- P3 adds two separate `describe` blocks plus that line check.
- `index.ts` adds exports `getNexusStats`, `NexusStats` and `NexusEnvironment`; `next.tsx` re-exports `getNexusStats` and the `NexusEnvironment` type.

**P2 ↔ P4 (wire and HTTP)**
- `POST ROUTES.ingest.config.path` takes the body `{key, client?: {sdk, version}}` as `text/plain;charset=UTF-8`, with `credentials:'omit'`.
- 200 returns `SdkRemoteConfig`.
- Kill = a 401/403 with `error.code ∈ SDK_KILL_ERROR_CODES`.
- Error responses on POST `ingest.browser` / `ingest.config` carry ACAO + ACAC for any origin that some app allows.
- `client.replay: true` only on cross-load replays.

**P5 ↔ P6:** the DTOs in §2, the `env` query param, and Live always prod.

**P2/P3 → P7:**
- the tarball `nexus-react-1.1.0.tgz`;
- `installNexusEarly({url, publishableKey})`, where `publishableKey` is required to be useful;
- the FastAPI `NexusClient(url, key, *, environment=None, …)`, with `sdk_version "1.1.0"`.

---

## 5. Risks and how the spec avoids them

| Risk | Mitigation |
|---|---|
| Checksum drift or a 0007 collision | Only new files 0007–0012; never edit 0001–0006. Pre-flight `migrate:status`; reset a dev DB that still holds `0007_grants`. |
| Runner tests collide on temp file 0007 | `FREE_VERSION` is derived; every hard-coded `0007_` name and expectation is replaced; the rollback assertions are derived as versions and as labels. |
| Fresh-DB grants (42501) | The 3 tables go into `grants.ts`, with a privileges test and the README correction. |
| Locks on partitioned tables | ADD COLUMN with a constant default is metadata-only. CHECK and index builds scan partitions in the runner transaction (≈28k rows/month, acceptable). The index is in its own file; deploy off-peak; no CONCURRENTLY; aggregate tables are not partitioned. |
| Parity tests | Every enum or limit column has an ENUM_CHECKS / TEXT_CHECKS row; constraint names are fixed; the audit CHECK keeps its name. |
| Routes contract / web coverage | `PENDING_ROUTE_LEAVES = []`. P4 registers all 4 leaves (controller last; preflight via `r.use`). P6 adds the 3 `api.*` functions. The public leaf is in `ingest`, hand-added to OpenAPI. `security.test.ts` is updated by P4. |
| P4/P5 runtime coupling (undefined handlers crash the router) | P5 delivers the controller properties first; the api gates run jointly. |
| Unowned files | `express.d.ts`, `cache-control.ts`, `rate-limit`, `browser-ingest-cors`, `security.test.ts`, `repositories.integration.test.ts`, the insert tests and `live-feed.test.ts` → P4. `mappers.test.ts`, `analytics-rows.ts`, `analytics-seed.ts` → P5. `appForm.test.ts`, `metricCopy.test.ts`, `ApplicationsView.test.tsx` → P6. `02-architecture`, `09-local-development` → P8. |
| zod leaking into SDKs | SDKs import only zod-free subpaths (now including `/errors`). Wire types are hand-mirrored and tested against the zod schemas. `sdk:pack` runs at the checkpoint. |
| The early bundle pulls in the tracker | URL helpers live in leaf `ingest-urls.ts`, the cache reader in `config-cache.ts`. `early.ts` never imports `registry`, `browser-tracker` or `remote-config`. Acceptance: ≤ 8 KiB with no BrowserTracker. |
| Vite early install runs too late (ESM hoisting) | An app-local `nexus-early.ts` as the first import of `main.tsx`; a snippet test checks the line; the guide explains why. |
| Kill codes unreadable cross-origin | Pre-auth early CORS for registered origins on the browser and config routes, with e2e tests. The SDK treats opaque failures as "keep state". The ingest kill is still enforced server-side for every SDK. |
| The kill switch cannot remove patches | Wrappers check live state on every call and pass through when disabled; `applyDisabled` restores patches if they are still ours; `publishableKey` is required for the early install. |
| Kill switch → IP limiter blackholes other apps behind a NAT | Only `KEY_GUESS_ERROR_CODES` count, decided on `res.locals.errorCode`. |
| Config polls eat the ingest budget or the KPI | A separate `browserConfigRateLimit` instance with a no-op onLimited; no rejection recorder on config. |
| Persisted poison or killed batches loop | Purge on kill; drop 400/413/415/ORIGIN_NOT_ALLOWED; persist opaque failures once; 3-replay cap; 24 h TTL. |
| Storage quota and a stale queue | A dedicated `RetryStorage` with no memory fallback; quota → drop and count; 128 KiB per scope. |
| Host fetch interceptors hijack SDK requests | The native fetch is captured before patching and used only for ingest and config. |
| XHR patch breaks the host (sync XHR, double send) | `apply(this, arguments)`, state reset on open, decoration-only try/catch, tests for every case. |
| The Next adapter throws in render | The whole template computation is try/catch; `useParams() === null` is handled; tests cover it. |
| Breaking host apps in general | Every SDK path is guarded; patches fall back; header de-duplication; cross-origin only via an allowlist; remote config can only disable; config fails open; the envelope `environment` is lenient; template/tz/lang/release problems are soft drops. |
| Sessions paired with dead page views | Idle rotation kept in `peekCurrent`; the page-view header is sent only when its session matches. |
| FastAPI exact-key snippet test | P3 updates the Python body literal in the same package. |
| React snippet describe.each needs tools | The early snippets get separate describes and are never rows of the existing table. |
| PII rules | Pass 1 scrubs before id hashing; pass 2 scrubs bare phone/Aadhaar segments in the stored path; counters store codes, fields and counts only; reject reasons store normalised paths, never messages; the retry queue never stores `user`; replays skip cookie identity; keys never appear in URLs; logs carry codes only. |
| PII false positives / id splits | Strict pass-1 patterns. Pass 2 runs after ids are computed, so endpoint and page ids are unaffected. The raw-path loss of 10-digit ids starting 6–9 is documented in ADR 0010. |
| Redaction lengthens a field | `token.length ≤ PII_MIN_MATCH_LENGTH[kind]` is asserted. |
| Rejection cardinality / sender-chosen text | `normalizeSdkLabel` (strict, else `''`); ORIGIN_NOT_ALLOWED rows always get sdk `''`; ≤ 20 keys per batch; normalised schema paths; 90-day retention. |
| Two definitions of a KPI | One `coverage-predicates.ts` is used by `summarizeActivityByApp`, `summarizeTrafficByApp` and `sdkHealthSql`; one threshold in shared; the copy states combined versus per-source. |
| `SERVER_EVENT_KIND` does not exist | The typed-const pattern `const HTTP_KIND: ServerEventKind = 'http'`. |
| Environment not reaching every read | `TrafficFilter.environments` is required; hand-built windows are listed; there is a unit test per statement builder; Live is prod-only by design. |
| Page-id cut-over (A1) | CHANGELOG, PROGRESS and ADR 0013 document it; no backfill; the SDK sends no template when unsure. |
| Old 1.0.0 SDKs | Server fallbacks: template guessing, environment default prod plus loopback → dev, and the kill switch enforced at ingest. |
| Retention breaks the layer chain | Job → `AggregateRetentionService.deleteExpired` → `AggregateRetentionRepository.deleteExpired`. |
| Key and origin cache staleness | The config rides AppKeyCache; `invalidateApp` runs after commit; `AllowedOriginCache` has a 30 s TTL; ≤ 30 s lag documented. |
| CLAUDE.md rule 5 with multiple waves | One commit after the FINAL gate, containing PROGRESS and all ai-context changes. |
| EBO pitfalls | The lockfile is refreshed via `npm install file:…`; `NEXT_PUBLIC_*` stay literal; the vendored Python is ruff-formatted and mypy-strict; no EBO commit; other `D:\server` apps are untouched. |
| Version literals | One bump to 1.1.0 across package.json, version.ts, `EXPRESS_SDK`, `SDK_VERSION`, test literals, snippets, READMEs and EBO. The docs.controller fixture literal stays. |

---

## Changes from v1

1. The P3 snippet contract test no longer adds a 2-column row to the React `describe.each` (it needs 3 columns and tools). Instead there are separate `describe` blocks for `next-instrumentation-client.ts` and the new `vite-nexus-early.ts`, plus a check of the first-import line.
2. The PII token test "≤ 6 chars" is replaced by `PII_MIN_MATCH_LENGTH` per kind (`:aadhaar` is 8 chars and was failing).
3. **Cross-origin errors.** New pre-auth `browserIngestEarlyCorsMiddleware` + `AllowedOriginCache` on POST `ingest.browser` / `ingest.config`, so a cross-origin SDK can read kill codes and drop codes. The preflight now uses the cache. e2e tests added.
4. `resolveIngestUrl` / `resolveConfigUrl` move to a leaf `core/ingest-urls.ts`, and the config cache reader to `core/config-cache.ts`. `early.ts` no longer imports `registry`.
5. `AppAdminService.updateSdkConfig` signature corrected to `(slug, body, actor: Viewer)`; it loads keys in the transaction and returns `mapApp(app, keys)`.
6. **Header exclusion** covers every ingest route (browser and config). The SDK transport and config client use a native fetch captured before patching, so host interceptors never touch them.
7. `peekCurrent` keeps idle rotation (it drops only the email rotation). The page-view header is sent only when the view's session matches.
8. **Runner tests:** `FREE_VERSION` replaces every hard-coded `0007_` temp name and expectation, and the rollback assertions are derived as versions and as labels.
9. Controllers use the `validQuery` / `validBody` / `validParams` accessors. `express.d.ts` (`errorCode`) and `cache-control.ts` (`NO_STORE_CACHE`) are now owned by P4.
10. The SSO reason is typed from `@nexus/auth` `CookieVerifyResult`, and an ok cookie with an implausible email maps to `'no-email'`.
11. `IDENTIFIED_SQL` is also used by `summarizeActivityByApp`; the copy states combined (Applications) versus per-source (Integration Health).
12. The rejection recorder is mounted only on `ingest.server` / `ingest.browser`; config failures are never recorded.
13. `security.test.ts` is assigned to P4, with `updateSdkConfig` in the expected list and a valid body.
14. P4 and P5 are declared one api gate unit. P5's first deliverable is the controller properties and service signatures.
15. P4 updates its own `appRow()` in `test/ingest-fixtures.ts`.
16. Added `SDK_KILL_ERROR_CODES` / `KEY_GUESS_ERROR_CODES` to shared `errors.ts`, and `@nexus/shared/errors` to the SDK import allowlist.
17. **Ownership gaps closed:**
    - P4: `rate-limit`, `browser-ingest-cors`, the insert tests, `repositories.integration.test.ts`, `live-feed.test.ts` (new, replacing the nonexistent file in v1)
    - P5: `mappers.test.ts`, `analytics-rows.ts`, `analytics-seed.ts` (moved from P4), the new `app-sdk-config.integration.test.ts`
    - P6: `appForm.test.ts`, `metricCopy.test.ts`, `ApplicationsView.test.tsx`
    - P8: `02-architecture.md`, `09-local-development.md`
18. **Retention** goes through the new `AggregateRetentionService.deleteExpired`; the job no longer calls a repository directly.
19. A separate `browserConfigRateLimit` instance (no ingest counters) is used for the config route.
20. **Commit cadence:** exactly one commit after the FINAL gate (rule 5).
21. `LINKABLE_SQL` uses the typed-const `HTTP_KIND` pattern, since shared has no `SERVER_EVENT_KIND`.
22. **Kill switch in the current page:**
    - the wrappers check live state on every call;
    - `applyDisabledForScope` restores the patches if they are still ours and purges the persisted queue;
    - `publishableKey` is required for `installNexusEarly`.
23. **Vite early install:** an app-local `nexus-early.ts` as the first import of `main.tsx`, because ESM hoisting makes a call in the main body too late.
24. **XHR patch semantics are pinned:**
    - `apply(this, arguments)` preserves async;
    - state resets on `open`;
    - decoration-only try/catch, so the original is never called twice;
    - a guarded `setRequestHeader`;
    - tests for each.
25. **IP failure limiter** counts only `KEY_GUESS_ERROR_CODES`, so kill-switch 403s cannot blackhole a NAT.
26. **Rejection sdk** is normalised by the strict `normalizeSdkLabel`, else `''`; ORIGIN_NOT_ALLOWED rows always get `''`; this also prevents the CHECK failure.
27. **PII pass 2:** a stored-path segment scrub for bare 10-digit mobiles and Verhoeff-valid 12-digit Aadhaar, run after id hashing. Adds `PII_SEGMENT_PATTERN_SOURCES`.
28. The Next template computation is fully try/catch, and `useParams() === null` is handled.
29. **Retry queue hardening:**
    - its own `RetryStorage` (no memory fallback, quota → drop and count);
    - purge on kill;
    - opaque failures persisted once;
    - `retryQueueMaxReplays = 3`;
    - `retryQueueMaxBytes` lowered to 128 KiB;
    - 403 ORIGIN_NOT_ALLOWED → drop.
30. `environment` is explicitly not an ActorColumn, so the actor parity test is unchanged.
