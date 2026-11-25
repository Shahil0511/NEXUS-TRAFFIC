# 03 — code navigation

Where to start reading code, which folder is which layer, and the chains that exist: server ingest
and app/key admin (S1, admin UI + Integration Health in S5 §4/§4b), the dashboard read side UI → SQL for Overview / API Routes / Errors (S2) and the following pages (S3–S5), the background jobs (S6, §5d), and the Phase A additions (SDK remote config §3c, environment filter, breakdowns, diagnostics, aggregate retention). See [README.md](README.md) for the reading order and [PROGRESS.md](PROGRESS.md)
for status.

## 1. Entry files

| File | What it is |
|---|---|
| `packages/shared/src/routes.ts` | `ROUTES`: every API path. Start every trace here (Shift+F12 on a leaf). |
| `packages/shared/src/ingest/schemas.ts` | The public ingest contract v1 (zod), plus `examples.ts`. |
| `apps/api/src/server.ts` | Process entry: config → container → schema guard → partitions → listen → realtime → jobs. |
| `apps/api/src/socket.ts` | `createRealtime`: Socket.io on the HTTP server (origin policy, `/live` namespace auth, subscriptions, tick timers). |
| `packages/shared/src/events.ts` | The socket contract: `SOCKET_NAMESPACES`, `SOCKET_EVENTS`, typed event maps, `liveRoom()`, `LIVE_TICK_MS`. |
| `apps/api/src/container.ts` | THE composition root; every class is built here once. |
| `apps/api/src/app.ts` | Express wiring (helmet, request id, access log, `/api` router, 404, errors). |
| `apps/api/src/http/routes/index.ts` | THE route table: path → middleware chain → controller method. |
| `apps/api/src/db/migrate.ts` | The `migrate` CLI (compose `migrate` service), see `apps/api/migrations/README.md`. Config + `DB_APP_ROLE_MODE`: `apps/api/src/db/migrate-config.ts`. |
| `apps/api/src/db/migration-runner/runner.ts` | One migrate run: bootstrap (`bootstrap.ts`) → plan → apply → `nexus_app` grants (`grants.ts`, separate mode only) → partitions. |
| `docker-compose.yml`, `apps/api/Dockerfile` | (postgres, `--profile localdb` only) → migrate → api → web → edge (the one published port, `ops/nginx/edge.conf`), pg-backup. Production DB: external server (ADR 0002). |

## 2. Folder → layer map (`apps/api/src`)

| Folder | Layer | Rule |
|---|---|---|
| `http/routes/` | route table | only file that maps a `ROUTES` leaf to handlers |
| `http/middleware/` | cross-cutting HTTP | auth, CSRF, body parsing, validation, rate limits, errors |
| `http/controllers/` | HTTP adapters | arrow-property methods named like the `ROUTES` leaf; no logic |
| `services/` | use cases | orchestrate; method name = leaf name; `@see` to repositories |
| `enrichment/` | pure-ish transforms | one transformation per class; `ServerEventEnricher` / `BrowserEventEnricher` orchestrate |
| `auth/` | key + SSO auth | parse / hash / generate / cache keys; read the SSO cookie (typed `CookieFailureReason`); `allowed-origin.cache.ts` (`AllowedOriginCache`, one instance per rule: preflight / early CORS) |
| `domain/` | types + pure rules | `rows.ts`, `inserts.ts`, `viewer.ts`, `mappers.ts` (row → DTO, IP admin-only), `to-api-request-insert.ts` / `to-web-event-insert.ts` (wire → row), `base-path.ts` (browser base-path rule), `browser-sdk.ts`; Phase A ingest rules: `environment.ts` (`resolveEnvironment`), `route-template.ts` (`isPlausibleRouteTemplate`), `sdk-label.ts` (`normalizeSdkLabel`), `schema-path.ts` (`normalizeSchemaPath`), `ingest-diagnostics.ts` (rejection / PII increments, `beaconOriginOf`), `sdk-config.ts` (`toSdkRemoteConfig`), `integration-health.ts` (status, warnings, `integrationLevelOf`); read side: `filters.ts` (repository inputs), `compute-deltas.ts` (KPI deltas), `timeseries-gaps.ts` (zero-filled IST buckets), `session-replay.ts` (API calls interleaved into a replay), `pagination.ts` (limit + 1, cursors), `numbers.ts` (rounding) |
| `repositories/` | SQL | one class per table concern; `@see ../../migrations/NNNN_x.sql` |
| `db/` | DB plumbing | pools, transactions, pg error classifiers, migration runner, schema guard |
| `jobs/` | timers | partition maintenance, retention (listed in `jobs/scheduler.ts`) |
| `live/` | realtime | `LiveFeed` (ingest → live) → `LiveWindow` (current-minute counters) + `LiveBroadcaster` (per-role rooms); socket auth, origin policy, subscriptions, sweeper, `LiveTickScheduler` |
| `config/`, `lib/`, `errors/`, `context/`, `lifecycle/` | infrastructure | env schema, logger, clock, `AppError`s, request context, shutdown |

Tests: unit tests sit next to the file (`*.test.ts`); DB suites are `*.integration.test.ts` and
self-skip unless `RUN_DB_TESTS=1`. Shared helpers live in `apps/api/test/` (`db/test-database.ts`
creates a fresh migrated database per suite). Contract tests: `apps/api/test/routes-contract.test.ts`
(every leaf registered exactly once; `PENDING_ROUTE_LEAVES` is empty since S5),
`apps/api/test/no-scaffolding.test.ts`, `apps/api/test/db/schema-parity.integration.test.ts`.
End to end: `apps/api/test/e2e/ingest.integration.test.ts` (S1 server + S3 browser beacons) and
`apps/api/test/e2e/dashboard.integration.test.ts` (S2 + S3 read routes). The read side is proven on a real
database by `apps/api/test/db/analytics-queries.integration.test.ts`; the datasets live in
`apps/api/test/db/analytics-seed.ts` (`seedAnalytics` for S2, `seedJourneys` for the S3 browser sessions,
each in its own database).
Security suite (S6): `apps/api/test/security/security.test.ts` (no DB; its header table maps every plan
case to the test that proves it) + `apps/api/test/security/security.integration.test.ts`. Docs stay true:
`apps/api/test/ai-context-links.test.ts` (every repo path mentioned in ai-context exists). Browser smoke of
the running stack (not in `npm test`): `apps/web/e2e/smoke.spec.ts` (`npm run test:smoke`).

## 3. The server ingest chain (`POST /api/v1/ingest/server`)

```
packages/shared/src/routes.ts                       ROUTES.ingest.server = { method: 'POST', path: '/v1/ingest/server' }
apps/api/src/http/routes/index.ts                   r.post(ROUTES.ingest.server.path, …chain…, ctl.ingest.server)
  apps/api/src/http/middleware/rate-limit.middleware.ts    ipFailureLimitMiddleware   (failed auths per IP)
  apps/api/src/http/middleware/json-body.middleware.ts     serverIngestJsonBody       (size + content type)
  apps/api/src/http/middleware/ingest-auth.middleware.ts   serverKeyAuthMiddleware    (X-Nexus-Key → res.locals.ingest)
    apps/api/src/auth/app-key.authenticator.ts             AppKeyAuthenticator.authenticate
      → api-key.parser.ts (parseApiKey) → app-key.cache.ts → api-key.hasher.ts
      → repositories/api-key.repository.ts (findByPrefix, touchUsage) + app.repository.ts (findById)
  apps/api/src/http/middleware/rejection-recorder.middleware.ts  rejectionRecorderMiddleware (serverRejectionRecorder:
                                                    on 'finish', a 400 INVALID_ENVELOPE → IngestRejectionRepository.increment)
  apps/api/src/http/middleware/rate-limit.middleware.ts    keyRateLimitMiddleware     (per key id)
  apps/api/src/http/middleware/validate.middleware.ts      validateBody(serverIngestEnvelopeSchema)
apps/api/src/http/controllers/ingest.controller.ts  IngestController.server  (?dryRun=1, X-Nexus-Contract header)
apps/api/src/services/ingest.service.ts             IngestService.ingestServerEvents
  once:      ServerEventEnricher.enrichEnvelope → domain/environment.ts resolveEnvironment (claim only, ADR 0008)
  per event: serverEventSchema → enrichment/event-time.guard.ts → ServerEventEnricher.enrich
apps/api/src/enrichment/server-event.enricher.ts    path.sanitizer → pii.scrubber pass 1 (path, routeTemplate, errorCode,
                                                    requestId, release) → route.normalizer → toEndpointId
                                                    (@nexus/shared/endpoint-id) → pii.scrubber pass 2 (stored path segments)
                                                    → ip.anonymizer → geo-ip.enricher → user-agent.parser
                                                    → identity.resolver → user-key.hasher   (PiiFindings: pii-findings.ts)
apps/api/src/domain/to-api-request-insert.ts        toApiRequestInsert(event, enrichment) → ApiRequestInsert
apps/api/src/repositories/api-request-ingest.repository.ts  ApiRequestIngestRepository.insertBatch
                                                    (unnest INSERT … ON CONFLICT DO NOTHING RETURNING event_id)
apps/api/migrations/0004_api_requests.sql           traffic.api_requests (monthly partitions, CHECKs = shared limits; +0007 environment)
  then (after commit, each in its own try/catch): repositories/ingest-counter.repository.ts (0006),
        ingest-rejection.repository.ts (0010, per-event codes via domain/ingest-diagnostics.ts toRejectionIncrements),
        pii-detection.repository.ts (0011, inserted rows only, toPiiIncrements) and live/live-feed.ts (prod rows only)
```

Failure paths: a missing partition triggers `PartitionRepository.ensure` and ONE retry; a CHECK
violation bisects the batch so only the bad rows come back as `DB_CONSTRAINT`; DB unavailable → 503
`INGEST_UNAVAILABLE` with Retry-After. `errorHandlerMiddleware` sets `res.locals.errorCode`, which the
rejection recorder and `ipFailureLimitMiddleware` read (only `IP_FAILURE_ERROR_CODES` count — the
key guesses plus `ORIGIN_NOT_ALLOWED`; `isCountedIpFailure`, ADR 0009). `GET /api/v1/ingest/verify` runs `anyKeyAuthMiddleware` →
`IngestController.verify` → `IngestService.verify` (no DB write besides the usage touch).

### 3b. The browser ingest chain (`POST /api/v1/ingest/browser`, S3)

Same storage path as §3, but the key is in the BODY (sendBeacon sends `text/plain`, no custom headers),
so auth runs after parsing; the actor (identity, IP, geo, UA) is resolved ONCE per beacon.

```
packages/shared/src/routes.ts                       ROUTES.ingest.browser = { method: 'POST', path: '/v1/ingest/browser' }
apps/api/src/http/routes/index.ts                   r.use(path, browserIngestPreflight)  (OPTIONS only: 204, reflects a
                                                    registered origin — auth/allowed-origin.cache.ts AllowedOriginCache.allows
                                                    → AppRepository.anyAllowsOrigin, 30 s LRU, one in-flight lookup per origin)
                                                    r.post(ROUTES.ingest.browser.path, …chain…, ctl.ingest.browser)
  apps/api/src/http/middleware/browser-ingest-cors.middleware.ts  browserIngestEarlyCorsMiddleware (FIRST: Vary + ACAO/ACAC
                                                    for an origin ANY app lists — killed / disabled apps included —
                                                    AllowedOriginCache rule 'registered' → AppRepository.anyListsOrigin,
                                                    so pre-auth errors and kill codes are readable — ADR 0009)
  apps/api/src/http/middleware/rate-limit.middleware.ts      ipFailureLimitMiddleware (own instance: browserIpFailureLimit)
  apps/api/src/http/middleware/beacon-body.middleware.ts     beaconBodyMiddleware     (text/plain | application/json, 60 KiB)
  apps/api/src/http/middleware/parse-beacon-json.middleware.ts  parseBeaconJsonMiddleware (malformed → INVALID_ENVELOPE)
  apps/api/src/http/middleware/validate.middleware.ts        validateBody(browserIngestEnvelopeSchema)
  apps/api/src/http/middleware/ingest-auth.middleware.ts     publishableKeyAuthMiddleware (body `key`; AppKeyAuthenticator
                                                    with 'publishable': secret → markExposed + 403 SECRET_KEY_EXPOSED,
                                                    APP_DISABLED; then 403 BROWSER_INGEST_DISABLED = the kill switch)
  apps/api/src/http/middleware/rejection-recorder.middleware.ts  browserRejectionRecorder (403 ORIGIN_NOT_ALLOWED, sdk always '')
  apps/api/src/http/middleware/browser-ingest-cors.middleware.ts  browserIngestCorsMiddleware (reflects Origin only if in
                                                    app.allowed_origins, with credentials; never *)
  apps/api/src/http/middleware/origin-guard.middleware.ts    originGuardMiddleware   (Origin decides; 'null' rejected; Referer
                                                    only when Origin is absent; neither → 403 ORIGIN_NOT_ALLOWED)
  apps/api/src/http/middleware/rate-limit.middleware.ts      keyRateLimitMiddleware (INGEST_RATE_LIMIT_BROWSER_PER_MIN) →
                                                    sessionRateLimitMiddleware (app + sessionId, …_PER_SESSION_PER_MIN)
apps/api/src/http/controllers/ingest.controller.ts  IngestController.browser  (req.ip, User-Agent, Cookie → BrowserRequestInfo;
                                                    sdk = domain/browser-sdk.ts browserSdkOf(envelope.client))
apps/api/src/services/ingest.service.ts             IngestService.ingestBrowserEvents
  once:      BrowserEventEnricher.enrichActor → identity.resolver forBrowser (SSO cookie → sso_cookie, a replay skips it;
             else user.email hint → client_claimed = claimed_email ONLY; user_key only for sso_cookie) → ip.anonymizer /
             geo-ip / user-agent; envelope columns: resolveEnvironment (loopback origin → dev), client tz/lang
             (CLIENT_*_PATTERN), release (PII-scrubbed)
  per event: browserEventSchema → event-time.guard → domain/base-path.ts isWithinBasePath (PATH_OUTSIDE_APP)
             → BrowserEventEnricher.enrich (path.sanitizer for path + referrerPath → domain/route-template.ts
             isPlausibleRouteTemplate → pii.scrubber pass 1 → route.normalizer → pii.scrubber pass 2)
apps/api/src/enrichment/browser-event.enricher.ts   (actor columns shared with the server path: enrichment/actor-columns.ts)
apps/api/src/domain/to-web-event-insert.ts          toWebEventInsert(event, enrichment) → WebEventInsert
apps/api/src/repositories/web-event-ingest.repository.ts  WebEventIngestRepository.insertBatch (same unnest + ON CONFLICT)
apps/api/migrations/0005_web_events.sql             traffic.web_events
  then: ingest-counter.repository.ts (source 'browser'), ingest-rejection / pii-detection repositories,
        sso-cookie-outcome.repository.ts (0012; not for replays; beaconOriginOf vs PUBLIC_ORIGIN) and
        LiveFeed.recordWebEvents (prod rows only)
```

### 3c. The SDK remote config chain (`POST /api/v1/ingest/config`, Phase A, ADR 0009)

```
packages/react/src/core/remote-config.ts            RemoteConfigClient (captured native fetch, credentials 'omit', polling floor)
  packages/react/src/core/ingest-urls.ts            resolveConfigUrl (buildIngestUrl + ROUTES.ingest.config)
  packages/react/src/core/config-cache.ts           per key scope cache (also read by the early entry); kill → core/kill.ts
packages/shared/src/routes.ts                       ROUTES.ingest.config = { method: 'POST', path: '/v1/ingest/config' }
apps/api/src/http/routes/index.ts                   r.use(path, browserIngestPreflight) + r.post(…chain…, ctl.ingest.config)
  browserIngestEarlyCors → browserIpFailureLimit → beaconBody → parseBeaconJson
  → validateBody(sdkConfigRequestSchema) → publishableKeyAuth (401/403 = the kill codes) → browserIngestCors
  → originGuard → browserConfigRateLimit (own keyRateLimit instance, no-op onLimited: no ingest_counters)
  (no session limiter, NO rejection recorder)
apps/api/src/http/controllers/ingest.controller.ts  IngestController.config  (200, Cache-Control: NO_STORE_CACHE, X-Nexus-Contract)
apps/api/src/services/ingest.service.ts             IngestService.config(app) — no I/O, the app rides AppKeyCache
apps/api/src/domain/sdk-config.ts                   toSdkRemoteConfig(AppRow) → SdkRemoteConfig
apps/api/migrations/0009_app_sdk_config.sql         apps.sdk_config_version / sdk_disabled_modules / sdk_config_updated_at
```

The admin side is `ROUTES.apps.updateSdkConfig` (§4). The SDK's other Phase A pieces:
`packages/react/src/early.ts` (`installNexusEarly`, ADR 0011), `core/header-source.ts` +
`core/fetch-patch.ts` + `core/xhr-patch.ts` (header propagation), `core/batch-sender.ts` +
`core/transport.ts` (`classifyDelivery`) + `core/retry-queue.ts` + `core/retry-storage.ts` (ADR 0012),
`core/route-template.ts` (`nextRouteTemplate`), `core/environment.ts`, `core/stats.ts` (`getNexusStats`).

Dedupe, partition retry, poison-row bisect and 503 are the SAME code as §3 (`IngestService.storeBatch`,
generic over the row type). `GET verify` accepts the publishable key too (`anyKeyAuthMiddleware`).

## 4. The app/key admin chain (`/api/v1/apps…`)

```
packages/shared/src/routes.ts                       ROUTES.apps.{list, create, update, createKey, expireKey, revokeKey, updateSdkConfig}
apps/api/src/http/routes/index.ts                   dashboard = [ssoAuth, dashboardCsrf]; admin = [...dashboard, requireAdmin]
  apps/api/src/http/middleware/sso-auth.middleware.ts      access_token cookie → Viewer (auth/sso-identity.reader.ts,
                                                           auth/dashboard-access.policy.ts)
  apps/api/src/http/middleware/dashboard-guards.middleware.ts  X-Nexus-Dashboard: 1 (CSRF) + requireAdmin
  dashboardJsonBody → validateParams / validateBody (packages/shared/src/schemas/apps.ts)
apps/api/src/http/controllers/app.controller.ts     AppController.<leaf>
apps/api/src/services/app-query.service.ts          AppQueryService.list   → AppRepository.list + ApiKeyRepository.listByAppIds
apps/api/src/services/app-admin.service.ts          AppAdminService.create / update / createKey / expireKey / revokeKey / updateSdkConfig
  one transaction each (db/transaction.ts): AppRepository / ApiKeyRepository + AdminAuditRepository.record,
  then AppKeyCache.invalidateApp after COMMIT; createKey uses auth/api-key.generator.ts (plaintext shown once);
  updateSdkConfig: requireApp → AppRepository.updateSdkConfig (conditional on expectedVersion; null → 409
  CONFLICT) → listByAppIds → audit APP_SDK_CONFIG_UPDATE → invalidateApp (ADR 0009)
apps/api/src/domain/mappers.ts                      mapApp / mapApiKey → AppDto / ApiKeyDto (never key_hash)
apps/api/migrations/0002_apps_and_api_keys.sql      traffic.apps, traffic.api_keys
apps/api/migrations/0003_admin_audit_log.sql        traffic.admin_audit_log (append-only for nexus_app)
```

Web half (S5, admins only; non-admins get `components/AdminOnly.tsx` from the `useMe` flag):
`app/(dashboard)/apps/page.tsx` (passes NEXUS_URL from the server env) → `features/apps/AppsView.tsx` →
`AppCard.tsx` (settings, integration values, key table `keyColumns.tsx`) + dialogs `AppFormDialog.tsx`
(create/update, validated with the shared schemas in `appForm.ts`), `CreateKeyDialog.tsx` (one-time reveal +
copy; the plaintext lives only in component state, mutation `gcTime: 0` + `reset()`), `KeyActionDialog.tsx`
(expire with a grace period / revoke, in-page confirm), `RemoteConfigDialog.tsx` (kill switch via `useUpdateApp`
first, then module switches via `useUpdateSdkConfig`; form helpers and `SDK_MODULE_COPY` in `appForm.ts`) →
`useAppMutations.ts` (invalidates `qk.apps.all` + `qk.integration.all`) → `api.apps.<leaf>` (`lib/api.ts`, sends
`X-Nexus-Dashboard: 1`).

### 4b. The Integration Health chain (S5, `GET /api/v1/integration/health`)

```
apps/web/src/app/(dashboard)/integration/page.tsx       reads the web env (loadWebEnv) → dashboardAccessOf (dashboardAccessCheck.ts) → one enum prop
apps/web/src/features/integration/IntegrationView.tsx   Checklist: counts in one HeadlineSentence (healthHeadline.ts); Platform = the
                                                        dashboard-access CheckRow (DASHBOARD_ACCESS_COPY); Apps = one CheckRow per app
                                                        (components/CheckRow.tsx; fail → warn → pass, orderByHealthMark in healthMark.ts;
                                                        summary + How to fix from appCheckSummary.ts; Show details = AppHealthDetails)
                                                        (global ?app= narrows client-side and opens the row)
apps/web/src/features/integration/integrationCopy.ts    warning/status copy + guide chapter (lib/guide.ts guideHref → /traffic/api/docs/#…)
apps/web/src/features/integration/useIntegrationHealth.ts  useQuery(qk.integration.health()) → api.integration.health
packages/shared/src/routes.ts                           ROUTES.integration.health (...dashboard, any viewer)
apps/api/src/http/controllers/integration.controller.ts IntegrationController.health (private, max-age=15)
apps/api/src/services/integration.service.ts            IntegrationService.health: window = INTEGRATION_HEALTH_WINDOW_MS, rows per app
apps/api/src/domain/integration-health.ts               integrationStatusOf / privateIpRatioOf / countersBySource / integrationWarningsOf
                                                        / integrationLevelOf + coverage and release folds
                                                        (thresholds: packages/shared/src/constants/integration.ts)
apps/api/src/repositories/ingest-health.repository.ts   IngestHealthRepository.perApp (QUERY pool, reads in parallel): apps + newest
                                                        event per source (DESC LIMIT 1), Σ ingest_counters, SDK stats per table
                                                        (sdkHealthSql: skew, private IPs, identified / linkable / linked / page-view
                                                        linked, release + latest release), ENVIRONMENT_MIX_SQL, REJECTION_REASONS_SQL
                                                        (≤ MAX_REJECTION_ROWS_PER_APP per app), PII_DETECTIONS_SQL,
                                                        SSO_COOKIE_OUTCOMES_SQL, exposed live keys
  apps/api/src/repositories/coverage-predicates.ts      IDENTIFIED_SQL / LINKABLE_SQL / LINKED_SQL / PAGE_VIEW_LINKED_SQL — the ONE KPI
                                                        definition (also used by the Applications page queries)
apps/api/src/domain/mappers.ts                          mapIngestCounter / mapSdkHealth / mapExposedKey (+ Phase A row mappers;
                                                        '' → null) → shared dto/integration.ts
```

Web: `AppHealthCard.tsx` exports `AppHealthDetails` (every block, no frame: used inside the Data health row) and
`AppHealthCard` (Card + header with `ViewTrafficLink` / `AppHealthBadges` + the details; kept for the App page;
block headings h3 under the card's h2, h4 under the row's h3 app name via `headingAs`, `blockHeading.ts`);
the details compose `IntegrationLevelBadge.tsx`, `CoverageStats.tsx`, `EnvironmentMix.tsx`,
`ReleaseStatus.tsx`, `PiiDetectionsTable.tsx`, `RejectionsTable.tsx`, `SsoOutcomes.tsx` (all in
`apps/web/src/features/integration/`), with `components/CoverageValue.tsx`; copy in `integrationCopy.ts`
(`LEVEL_COPY`, `pii_detected`, `DASHBOARD_ACCESS_COPY`). Not filtered by environment (ADR 0008). The access check
reads the WEB container's `DASHBOARD_ALLOWED_EMAILS` / `DASHBOARD_ALLOWED_DOMAINS`; the API gate reads its own copy
of the same keys (`packages/auth/src/dashboard-access.ts`), so both must be set alike.

Proven by `ingest-health.repository.test.ts` (SQL shape) and `apps/api/test/db/ingest-health.integration.test.ts`.

Health: `ROUTES.health.ready` → `HealthController.ready` → `HealthService.ready` (ping, schema guard,
future partitions). Docs: `ROUTES.docs.*` → `apps/api/src/http/controllers/docs.controller.ts`, serving
`docs/dist` built by `scripts/build-docs.ts` from `docs/integration/`.

## 5. The dashboard chain (S2): Overview, API Routes, Errors

Every analytics route uses `...dashboard` (`ssoAuth` + `dashboardCsrf`) and validates with the
SHARED schema of its leaf (`packages/shared/src/schemas/analytics.ts`). Leaf = controller method =
service method; the repository method is named in each service's `@see`. Example: the API Routes
table (`ROUTES.endpoints.list`), clicked from the UI down to SQL:

```
apps/web/src/features/endpoints/EndpointsView.tsx      table + search + PagesToolsTabs; const q = useEndpointStats(…)
apps/web/src/features/filters/useGlobalFilters.ts      nuqs URL state {app, range, from, to}
apps/web/src/features/endpoints/useEndpointStats.ts    useQuery(qk.endpoints.list(f)) → api.endpoints.list
apps/web/src/lib/api.ts                                api.endpoints.list → request(ROUTES.endpoints.list, q)
packages/shared/src/routes.ts                          ROUTES.endpoints.list = { method: 'GET', path: '/v1/endpoints' }
packages/shared/src/schemas/analytics.ts               endpointListQuerySchema (sort whitelist, cursor, limit)
apps/api/src/http/routes/index.ts                      r.get(…, ...dashboard, validateQuery(endpointListQuerySchema), ctl.endpoints.list)
apps/api/src/http/controllers/endpoint.controller.ts   EndpointController.list  (Cache-Control: private, max-age=15)
apps/api/src/services/endpoint.service.ts              EndpointService.list
  services/query-window.ts                             resolveQueryWindow (shared resolveTimeWindow; percentiles capped
                                                       at MAX_PERCENTILE_RANGE_MS → 400 RANGE_TOO_LARGE)
  services/app-slug.resolver.ts                        app slug → apps.id (unknown → 404)
apps/api/src/repositories/api-request-query.repository.ts  ApiRequestQueryRepository.listEndpointStats
                                                       (percentile_cont over kind='http', ORDER BY whitelist, offset cursor)
apps/api/migrations/0004_api_requests.sql              traffic.api_requests (+ 0002 traffic.apps for the slug)
apps/api/src/domain/mappers.ts                         mapEndpointStats → EndpointStatsDto (packages/shared/src/dto/endpoints.ts)
```

| ROUTES leaf | Controller / service method | Repository method(s) | Notes |
|---|---|---|---|
| `overview.summary` | `OverviewController.summary` / `OverviewService.summary` | `ApiRequestQueryRepository.summarizeTraffic`, `WebEventQueryRepository.summarizePageViews` / `countIdentifiedUsers` / `countActiveUsers` | current + previous window → `domain/compute-deltas.ts`; identified users over BOTH tables; active users = last `ACTIVE_USER_WINDOW_MS` |
| `overview.apps` | `OverviewController.apps` / `OverviewService.apps` | `ApiRequestQueryRepository.summarizeTrafficByApp`, `WebEventQueryRepository.summarizeActivityByApp`, `AppRepository.list` | one row per registered app (silent apps = zeros), deltas via `mapAppTraffic`; [ADR 0006](decisions/0006-navigation-search-and-applications.md) |
| `overview.breakdown` | `OverviewController.breakdown` / `OverviewService.breakdown` | `WebEventQueryRepository.countByDimension` (source=browser) / `ApiRequestQueryRepository.countByDimension` (source=server) | `BREAKDOWN_DIMENSION_VALUES` → frozen column whitelist; `share` = value ÷ all events in the window (`sum(count(*)) OVER ()`); page views (page_time for `time_reason`) |
| `overview.devices` | `OverviewController.devices` / `OverviewService.devices` | `WebEventQueryRepository.countDeviceReturn` | distinct `anonymous_id` on page views; returning = also seen in `[from − RETURNING_DEVICE_LOOKBACK_MS, from)` (30 d, bounded) |
| `overview.timeseries` | `OverviewController.timeseries` / `OverviewService.timeseries` | `ApiRequestQueryRepository.timeseries`, `WebEventQueryRepository.pageViewTimeseries` | `bucketExpr` (IST) in `apps/api/src/db/sql.ts`; gaps → `domain/timeseries-gaps.ts` |
| `endpoints.list` | `EndpointController.list` / `EndpointService.list` | `listEndpointStats` | offset cursor (`encodeOffsetCursor`) |
| `endpoints.detail` | `EndpointController.detail` / `EndpointService.detail` | `getEndpointDetail` | by stored `endpoint_id`; 404 when no rows; unique users for everyone; slowest samples (IP role-masked) and top callers (`listTopUsers`) for admins only, `null` otherwise (`forAdmins` in `apps/api/src/domain/viewer.ts`, [ADR 0019](decisions/0019-names-on-object-pages-for-admins.md)) |
| `errors.summary` | `ErrorController.summary` / `ErrorService.summary` | `summarizeErrors` | totals, by status, by app error code (`byErrorCode`), series, top failing endpoints, users affected; optional `endpointId` / `userKey` / `errorCode` scope (`FailureFilter` in `domain/filters.ts`) |
| `errors.list` | `ErrorController.list` / `ErrorService.list` | `listFailures` | keyset `(occurred_at, event_id)` DESC; counts cap `MAX_COUNT_RANGE_MS`; optional `endpointId` / `userKey` / `errorCode` scope (`FailureFilter`) |

Read-side rules (all in `apps/api/src/repositories/api-request-query.repository.ts`): every query is
bounded by `occurred_at >= from AND < to` (partition pruning) and carries the environment predicate
(`environmentConditions`; `TrafficFilter.environments` is required, absent `env` = `['prod']`, `all` = no
predicate; Live is fixed to prod; ADR 0008); failure filters emit the partial-index
predicate `status_code >= 400` LITERALLY (`FAILURE_PREDICATES`, never a parameter); the keyset cursor
carries `occurred_at` as microsecond text (`keysetTimeExpr` in `apps/api/src/db/sql.ts`), because a JS
`Date` keeps only milliseconds and would repeat rows at page boundaries. Both query repositories run on
the read-only QUERY pool. IPs leave the API for admins only (`mapActor` in `apps/api/src/domain/mappers.ts`).

### 5b. The browser analytics chain (S3): Users, Journeys, Pages & Tools, Geography

Same shape as §5 (`...dashboard`, shared schema per leaf, `Cache-Control: private, max-age=15`). Every
leaf reads `WebEventQueryRepository` (`apps/api/src/repositories/web-event-query.repository.ts`), which
also reads `api_requests` where a user's activity spans both tables. Example, the session replay:

```
apps/web/src/features/journeys/sessionColumns.tsx      row link PAGES.sessionDetail(app, sessionId)  (lib/pages.ts — slug + uuid only)
apps/web/src/app/(dashboard)/journeys/[app]/[sessionId]/page.tsx  sessionParamsSchema.safeParse(params) → 404 | <SessionDetailView>
apps/web/src/features/journeys/SessionDetailView.tsx   KPIs + <SessionReplay> (sessionSteps.ts groupSessionSteps: page → tools/API calls)
apps/web/src/features/journeys/useSessionDetail.ts     useQuery(qk.journeys.session(app, sessionId, f)) → api.journeys.session
apps/web/src/lib/api.ts                                api.journeys.session(app, sessionId, q) → request(ROUTES.journeys.session, q, {params})
packages/shared/src/routes.ts                          ROUTES.journeys.session = GET /v1/journeys/sessions/:app/:sessionId
packages/shared/src/schemas/analytics.ts               sessionParamsSchema + sessionQuerySchema (window; the PATH app wins)
apps/api/src/http/routes/index.ts                      r.get(…, ...dashboard, validateParams, validateQuery, ctl.journeys.session)
apps/api/src/http/controllers/journey.controller.ts    JourneyController.session
apps/api/src/services/journey.service.ts               JourneyService.session (slug → id, 404 when empty)
apps/api/src/repositories/web-event-query.repository.ts  getSession: header (sessionStatsStatement) + browser events
                                                       (seq, occurred_at, event_id; page_time folded) + API calls (app_id, session_id)
apps/api/src/domain/session-replay.ts                  interleaveByTime (API calls placed by time, seq order kept)
apps/api/src/domain/mappers.ts                         mapSessionSummary (IP admin-only) / mapSessionEvent → dto/journeys.ts
```

| ROUTES leaf | Controller / service method | Repository method | Notes |
|---|---|---|---|
| `users.list` | `UserController.list` / `UserService.list` | `listUsers` | verified only (`user_key IS NOT NULL`), both tables, offset cursor; `sessions` = browser sessions; `sort`/`dir` whitelist `USER_ORDER_SQL` (`lastSeen` default, `firstSeen`, and the counts `requests`, `pageViews`, `sessions`, `failed`; ties `u.user_key`; an unknown `sort` falls back to the default; [ADR 0018](decisions/0018-people-list-count-sorts-restored.md)) |
| `users.activity` | `.activity` | `listDailyUsers`, `countIdentifiedUsers` | DAU per IST day (gap-filled, `fillCountGaps`) + WAU/MAU ending at the window end; registered before `/:userKey` |
| `users.search` | `UserController.search` / `UserService.search` | `listUsers` | **POST** body `userSearchBodySchema` — the email never travels in a URL (ADR 0006) |
| `users.profile` | `.profile` | `getUserProfile` + `ApiRequestQueryRepository.listUserTopEndpoints` + `getUserLatestContext` | **admin-only** (`...admin`); by stored `user_key` (hex in the URL → `userKeyFromHex`); 404 when no rows; per-app activity (`listUserApps`); `latest` = the newest browser event's device / tz / lang / release (identity card) |
| `users.timeline` | `.timeline` | `listUserTimeline` | **admin-only**; API ∪ browser, keyset `(occurred_at, event_id)` DESC |
| `users.devices` | `.devices` | `listUserDevices` | **admin-only**; both tables grouped by `ua_device, ua_browser, ua_os` (newest first, `USER_DEVICES_LIMIT`); empty (not 404) without activity; read by the Devices tab only |
| `users.daily` | `.daily` | `listUserDailyActivity` | **admin-only**; window widened to whole IST days (`wholeReportingDays`), one SQL row per (IST day, app) (same day bucket as DAU, `USER_DAILY_APP_ROWS_LIMIT` + 1), folded by `foldUserDays` into one item per day with `perApp` in first-activity order (`dropTruncatedOldestDay` drops a day cut by the cap), newest first, idle days left out, today `inProgress`; first / last activity over both tables, tab visible time = Σ credited `page_time.visible_ms` (`creditedVisibleMs`) |
| `users.day` | `.day` | `listUserDailyActivity`, `listUserDayBlocks`, `listUserDayPages` (wave 1), then `listUserDayTools`, `listSessions` (wave 2, only when the day has activity) | **admin-only**; ONE IST day `?day=YYYY-MM-DD` (`userDayQuerySchema`, `reportingDayWindow`), app and env apply, the global range does not; 400 for a future day or one more than `USER_DAY_LOOKBACK_DAYS` back; at most 3 statements at once; `mapUserDayDetail` (summary = `foldUserDays` of the day, block totals from window functions before the LIMIT); `person_day` recorded even for an empty day (`emailLookup` = the day ∪ the last `MAX_COUNT_RANGE_MS`) |
| `users.pattern` | `.pattern` | `listUserActivityPattern` | **admin-only**; usual activity hours: `?range=7d\|30d` (`userPatternQuerySchema`, default 30d; the global range does not apply), widened to whole IST days (≤ 31); ONE statement over both tables grouped by IST weekday × hour (`reportingLocal`) with `GROUPING SETS` for the total active days; `mapUserActivityPattern` + `weekdayDayCounts`; `person_pattern` recorded even when empty (`emailLookup`, as for one day) |
| `journeys.sessions` | `JourneyController.sessions` / `JourneyService.sessions` | `listSessions` | strongest identity (`IDENTITY_RANKS`), entry/exit page, optional `userKey` (then admin-only + `person_visits`), offset cursor |
| `journeys.session` | `.session` | `getSession` (+ `findSessionUserKey` when the summary has no `user_key`) | see above; route open (`...dashboard`), but a visit with a `user_key` is a person-level read: `ForbiddenError` (403) for a non-admin, `person_visit_steps` for an admin, decided in `JourneyService.session` (`verifiedSubjectOf`: the summary's key, else a probe of the session over the window widened by `MAX_COUNT_RANGE_MS` each side) because it depends on the data ([ADR 0017](decisions/0017-person-daily-depth.md)); anonymous / claimed-only visits stay open; never refetched by live traffic (`isTrafficDrivenKey`) |
| `journeys.topPaths` | `.topPaths` | `listTopPaths` | 3-step `lead()` over page views, reloads collapsed; 31-day cap |
| `pages.list` | `PageController.list` / `PageService.list` | `listPageStats` | Σ credited `visible_ms` per page view → avg / p50 (31-day cap), exits, distinct users; `pageId` = `toPageId` |
| `pages.detail` | `.detail` | `listPageTemplates` → `getPageDetail` + `ApiRequestQueryRepository.listPageApiCalls` | opaque `pageId` resolved in the service ([ADR 0007](decisions/0007-page-and-tool-ids-and-drill-downs.md)); trend, viewers, tools, came from / went to; the controller passes the viewer and `topUsers` is `null` for non-admins (`forAdmins`, [ADR 0019](decisions/0019-names-on-object-pages-for-admins.md)) |
| `tools.usage` | `ToolController.usage` / `ToolService.usage` | `listToolUsage` | top tools + trend of those tools; gaps → `fillToolTrendGaps`; `toolId` = `toToolId` |
| `tools.detail` | `.detail` | `listToolNames` → `getToolDetail` | opaque `toolId` resolved in the service; users, pages, actions; `topUsers` `null` for non-admins (`forAdmins`, ADR 0019) |
| `geo.countries` / `geo.cities` | `GeoController` / `GeoService` | `listCountries` / `listCities` | API calls + page views per location (`geoStatement`) |

**Person-level leaves** (`PERSON_ROUTE_LEAVES` in `packages/shared/src/routes.ts`: `users.profile`,
`users.timeline`, `users.devices`, `users.daily`, `users.day`, `users.pattern`) use `...admin` (`ssoAuth` + `dashboardCsrf` +
`requireAdmin` → 403 `FORBIDDEN` for anyone else; proven per leaf by `apps/api/test/person-access.routes.test.ts`).
After a successful read, `UserService` calls `PersonAccessRecorder.record` (`apps/api/src/services/person-access.recorder.ts`):
coalesced in memory (`apps/api/src/services/person-access.coalescer.ts`, `PERSON_ACCESS_COALESCE_MS` = 10 min per
viewer + person + surface), the person's email looked up in the read's window (`WebEventQueryRepository.findUserEmail`)
(or in the wider `emailLookup` window a caller passes, so an empty one-day answer is still recorded)
and MASKED (`maskEmail`), then `PersonAccessLogRepository.record` (WRITE pool,
`apps/api/src/repositories/person-access-log.repository.ts`). No event in the window → no row; a failed write
only logs a warning (surface + pg code); a concurrent request with the same key waits for the running attempt and
records itself when that one wrote nothing. The lists (`users.list`, `users.search`, `users.activity`) stay `...dashboard`.
**Narrowed lists** (`PERSON_FILTERED_ROUTE_LEAVES`: `journeys.sessions`, `errors.summary`, `errors.list`, `live.online`)
stay `...dashboard` but run `mw.requireAdminForUserKey` after `validateQuery` (`dashboard-guards.middleware.ts`):
with `?userKey=` they are admin-only, and `JourneyService.sessions` / `ErrorService.summary` / `.list` record
`person_visits` / `person_failures` ([ADR 0015](decisions/0015-admin-only-person-pages-and-access-log.md)).
**Visit steps** (`journeys.session`) stay `...dashboard`; `JourneyService.session` refuses a non-admin (403) once the
visit has a `user_key` (in the summary, or in a wider probe of the same session: `findSessionUserKey`) and records
`person_visit_steps` for an admin; the web visit page then shows `PersonAdminOnly` (`SessionDetailView`, with
`isForbidden`, both from `components/PersonAdminOnly.tsx`). `UserService.daily`
widens its window to whole IST days (`wholeReportingDays`, `packages/shared/src/time-window.ts`) and flags today
`inProgress`; the profile carries the identity card's `latest` facts, so `users.devices` is read by the Devices tab only.

| ROUTES leaf | Controller / service method | Repository method | Notes |
|---|---|---|---|
| `privacy.accessLog` | `PrivacyController.accessLog` / `PrivacyService.accessLog` | `PersonAccessLogRepository.list` | **admin-only**; newest first, keyset `(viewed_at, id)` (`parseAccessLogCursor`), optional `userKey`; `no-store`; rows written by `PersonAccessRecorder` ([0013](../apps/api/migrations/0013_person_access_log.sql)) |

Non-paged lists (top paths, pages, tools, geo) return `WindowedListDto<T>` = `{ window, items }`.
`page_time` rows carry visible-ms DELTAS: the time of a page view is Σ `visible_ms` of the `page_time`
rows whose `page_view_id` is its `event_id` (`pageViewVisibleMs`); timelines and replays fold them into
the page view and never list them. Every such sum (page view, visit stats, page stats, person day) credits
one row at most `VISIBLE_DELTA_CREDIT_CAP_MS` through `creditedVisibleMs` (`apps/api/src/db/sql.ts`, a
NULL-safe CASE, never LEAST; [ADR 0017](decisions/0017-person-daily-depth.md)).

Web half (page → View → hook → `api.*`; every View reads the global filters from `useGlobalFilters`):

| Page (`apps/web/src/app/(dashboard)/…`) | View (`apps/web/src/features/…`) | Hook(s) → `api.*` | Notes |
|---|---|---|---|
| `users/` | `users/UsersView.tsx` | `useUserList` → `users.list`, `useUserSearch` → `users.search` | search text in React state only (never the URL); "Load more"; link `PAGES.userDetail(userKey)` for admins only (`features/me/useCanOpenPersonPages.ts`; plain text for viewers), app chips; every column but Person sorts server-side (`useUserListParams`, ADR 0018) |
| `users/[userKey]/` | `users/UserDetailView.tsx` (admins only: `useMe` decides before any person read; a non-admin, or a 403 from the API, sees `components/PersonAdminOnly.tsx`, built on `components/AdminOnly.tsx`) | `useUserProfile` → `users.profile`, `useUserDevices` → `users.devices`, `useUserDaily` → `users.daily`, `useUserDay` → `users.day` (sent only once `useMe` says admin), `useUserPattern` → `users.pattern` (only while `USUAL_ACTIVITY_HOURS_ENABLED` in `lib/featureFlags.ts` is on, after the daily read succeeded, for an admin), `useUserTimeline` → `users.timeline` | `userKeyParamsSchema` → 404; identity card `users/PersonIdentityCard.tsx` (always shown); tabs `?tab=summary\|daily\|devices\|activity` (`users/userDetailParams.ts`, nuqs): `UserSummaryTab.tsx`, `UserDailyActivityTab.tsx` (a switch on `?day=`, `useUserDetailDay`: a real day → `UserDayDetail.tsx`, header with All days / Previous / Today / Next / date input (`DayPicker`, a draft opened on Enter / blur / "Show day"), a day outside the lookback → "This day cannot be shown" with no read, 5 KPIs, `DayTimeline.tsx` + `UserDayBlocksTable.tsx`, `UserDayAppsTable.tsx`, `UserDayPagesTable.tsx` + `UserDayToolsTable.tsx`, `UserDayVisitsTable.tsx` with Visit steps links over that day (`visitStepsHref`), "End of day", `AboutTheseNumbers variant="day"`; else) → `UserDaysOverview.tsx` (totals, chart `components/charts/DailyBarChart.tsx` with whole-minute value ticks from `components/charts/durationTicks.ts`, rows from `userDailyColumns.tsx` in a `DataTable layout="fit"` (fixed column widths, wrapping cells) with the Date linking to the one-day view (`dayDetailHref`), `DayStrip.tsx`, per-app lines `DayAppList.tsx` and a per-day Visits link `dayVisitsQuery`, "End of list", `UsualActivityHoursPanel.tsx` + `HourGrid.tsx` (rendered only while the switch is on), `AboutTheseNumbers.tsx`; helpers `users/dailyActivity.ts`; neutral labels checked by `users/personCopy.test.tsx` with `lib/neutralCopy.ts`, ADR 0017), `UserDevicesTab.tsx` (helpers `users/personFacts.ts`), `UserActivityTab.tsx` (timeline columns in `userTimelineColumns.tsx`) |
| `journeys/` | `journeys/JourneysView.tsx` | `useTopPaths` → `journeys.topPaths`, `useSessionList` → `journeys.sessions` | `?userKey=` (`useSessionListParams`, from the person page's "View visits"; admin-only on the API, ADR 0015); `ClaimedBadge` via `ActorCell` |
| `journeys/[app]/[sessionId]/` | `journeys/SessionDetailView.tsx` | `useSessionDetail` → `journeys.session` | see the chain above |
| `pages/` · `tools/` | `pages/PagesView.tsx` · `tools/ToolsView.tsx` | `usePageStats` → `pages.list` · `useToolUsage` → `tools.usage` | ONE nav entry ("Pages & features", `alsoActiveOn`); `pages/PagesToolsTabs.tsx` is ONE tab row Pages / Features / Request types (`PagesToolsTab` = `pages` \| `tools` \| `endpoints`, links from `PAGES` carrying the global filters, `aria-current` on the open one, wraps on a phone) shown on `/pages`, `/tools` and `/endpoints`; "Request types" keeps its own sidebar item (`lib/nav.ts` unchanged); loaded-rows text filter (`components/LoadedRowsFilter.tsx`, never sent to the API or the URL) |
| `pages/[app]/[pageId]/` · `tools/[app]/[toolId]/` | `pages/PageDetailView.tsx` · `tools/ToolDetailView.tsx` | `usePageDetail` → `pages.detail` · `useToolDetail` → `tools.detail` | params validated with the API's schemas → 404; `PageLink` / `ToolLink` (`components/EntityLinks.tsx`) link every listed page/tool here; their text wraps only after `/ . - _` (`components/BreakableText.tsx`). Both are report sheets (`components/ReportSheet.tsx`): headline sentence (`pages/pageHeadline.ts` · `tools/toolHeadline.ts`) in the `PageHeader` headline, a facts strip (`components/FactSheet.tsx`), one wide chart, "What happens around it" (Came from / Went to) · "How it is used" (Actions) beside "Who uses it" (`components/WhoUsesIt.tsx`: count for everyone, names for admins, ADR 0019), and a wide "Used with" row (features + request types of the page · pages of the feature, each list under a `ReportSubsection` h3). On screen a tool is a "feature" (route, ids and types keep "tool") |
| `endpoints/[endpointId]/` | `endpoints/EndpointDetailView.tsx` | `useEndpointDetail` → `endpoints.detail` | a report sheet (`components/ReportSheet.tsx`): headline sentence `endpoints/endpointHeadline.ts` (calls, people, failed share in red via `formatFailedShare` ("<0.1%", never "0.0%", while a call failed) with refused 4xx / server-error 5xx, or "Nothing failed."; p50 / p95 when known) in the `PageHeader` headline next to MethodBadge + AppChip + window caption and the "View failures" action; facts strip API calls / Error rate / People / p50 (avg) / p95 / p99; "API calls over time"; "What happens around it" (Status codes, `ReportSubsection`) beside "Who uses it" (`WhoUsesIt`, unit calls); the wide "Speed and failures" row (Latency \| Errors, side by side from lg; this row sets it apart from the page / feature sheets); then "Slowest calls" (table for admins, `AdminsOnlyNote` "Only admins see single requests." when `slowest` is `null`). Every link is scoped to the route's own app |
| `devices/` | `devices/DevicesView.tsx` | `useBreakdown` → `overview.breakdown` (per dimension, `features/devices/DimensionSharePanel.tsx`), `useDeviceReturn` → `overview.devices`, the Places tab reuses `geography/GeoPlacesSection.tsx` | sidebar "Devices & places" (`alsoActiveOn` `/geography`); tabs `?tab=devices\|places` and the "Show share of" switch `?share=pageViews\|requests` (`features/devices/devicesParams.ts`, nuqs); `share=requests` reads `source=server` and greys out the dimensions the server source lacks without a request (`features/devices/shareOf.ts`); bars are `components/ProportionBar.tsx` (unit inside every label, "All other values" row, screen-reader table; helpers `components/proportionShares.ts`); "Show all values" dialog fetches `BREAKDOWN_LIMIT_MAX` on open |
| `geography/` | `geography/GeographyView.tsx` → `geography/GeoPlacesSection.tsx` | `useGeoCountries` → `geo.countries`, `useGeoCities` → `geo.cities` | old link, same nav item; `RankedBarChart`; cities labelled approximate; GeoLite2 attribution; `?metric=` (nuqs, or controlled by the Devices & places switch); "no location" notice when every row is unlocated (every request reaches Nexus from the gateway's internal address), linking Data health and the client-IP guide |
| `privacy/` | `privacy/PrivacyView.tsx` (admins only, `AdminOnly` otherwise) | `useAccessLog` → `privacy.accessLog` | sidebar Setup → "Privacy & access" (`PAGES.privacy()`); access-log table (`privacy/accessLogColumns.tsx`: when, admin, person masked, part of the page → `PAGES.userDetail` with `?tab=`), "Load more", "Only this person" `?userKey=` (`privacy/accessLogParams.ts`, nuqs, validated like `toUserKeyFilter`); the "What this dashboard records" list (`RECORDED_ITEMS`) |

| `applications/` | `applications/ApplicationsView.tsx` | `useAppTraffic` → `overview.apps`; `useIntegrationHealth` → `integration.health` (the rows' Data health marks, last 24 h, never blocks the table) | per-app table (`appTrafficColumns.tsx`); the app filter is hidden here; totals in one `HeadlineSentence` (`components/HeadlineSentence.tsx`, built by `applications/appsHeadline.ts`) in the `PageHeader` headline slot; each row's mark = `healthMarkOf` (`features/integration/healthMark.ts`) drawn by `components/HealthMark.tsx` |
| `applications/[app]/` | `applications/ApplicationDetailView.tsx` | `useAppTraffic`, `useOverviewTimeseries`, `useErrorSummary`, `useUserList` ("Who uses it": `sort=requests`, most API calls first; sent only once `useMe` says admin, everyone else sees the app's verified-people count and `AdminsOnlyNote` plus the "All users" link; a `/me` error shows `ErrorState`, ADR 0019), `useEndpointStats`, `usePageStats`, `useToolUsage` | `appSlugSchema` → 404; the PATH app overrides the global filter; keyed by app in the page file; audience section `ApplicationAudienceSection.tsx` → `features/breakdowns/` (`BreakdownPanel` + `useBreakdown` → `overview.breakdown`, `DeviceReturnPanel` + `useDeviceReturn` → `overview.devices`) |

Report sheet parts: `components/ReportSheet.tsx` (layout only: facts → wide chart → around | who → wide second
row → after; `ReportSubsection` = an h3 region inside a panel), `components/FactSheet.tsx` (`Fact` list, `strip` /
`stack`, `metricInfo` behind each (i), missing value → "not captured" without its note), `components/WhoUsesIt.tsx` (count sentence +
`TopUsersList` for admins, lock note when `users` is `null`), `components/AdminsOnlyNote.tsx` (`WHO_ADMINS_ONLY`,
`REQUESTS_ADMINS_ONLY`), `lib/countPhrase.ts` (`countPhrase`, `verifiedPeople`: singulars).

Drill-down helpers: `components/TopUsersList.tsx` (any `UserUsageDto[]`), `components/charts/CountChart.tsx`
(one count over time), `features/users/useUserListParams.ts` (`?sort=&dir=`, every `USER_SORT_VALUES` key; unknown → default), `?userKey=` and `?errorCode=`
on Errors (`features/errors/useErrorListParams.ts`; the "Error codes" panel is `features/errors/ErrorCodesList.tsx`).

Wave 3 UI helpers: `components/Breadcrumbs.tsx` (detail-page trails; `applicationCrumbs`; emails masked),
`components/WidenRangeButton.tsx` (next wider preset the page accepts, else a link to Integration),
`components/InfoTip.tsx` + `components/ui/tooltip.tsx` + `lib/metricCopy.ts` (metric definitions; `KpiCard info`,
`FactSheet` `info`, `DataTable` column `hint`), `components/CopyButton.tsx` (`CopyButton`, `CopyableText`), `components/MobileNav.tsx`
(nav sheet below md), `components/LoadedRowsFilter.tsx`; tokens in `app/globals.css` (checked by
`app/designTokens.test.ts`).

Environment filter (ADR 0008): `features/filters/EnvironmentSelect.tsx` in the `AppShell` top bar →
`useGlobalFilters` (`?env=`, absent = production) → every windowed `api.*` query; labels in
`features/filters/environmentLabels.ts`; `NavItem.filters.environment` turns it off on Live, Integration and Apps.

Navigation helpers: `components/CommandPalette.tsx` (Ctrl/⌘+K, mounted in `AppShell` TopBar),
`components/AppChip.tsx` (app → its page), `UserLink` in `components/ActorCell.tsx` (verified user → profile; a link for admins
only, `useCanOpenPersonPages`),
`components/RelativeTime.tsx`, `lib/useDocumentTitle.ts` (masked emails only), `NavItem.filters` +
`pageFiltersFor` in `lib/nav.ts` (which global filters a page shows, and its range cap).

Page frame (Phase B, [ADR 0014](decisions/0014-object-first-navigation-and-person-page.md); English-only copy, icons
and art [ADR 0016](decisions/0016-english-only-ui-icons-and-illustrations.md)): `NAV_SECTIONS` in
`apps/web/src/lib/nav.ts` groups the sidebar by object (top, People, Apps, Setup); each `NavItem` carries
`question` (one English sentence), printed by the hero `apps/web/src/components/PageHeader.tsx` on list pages.
The hero also shows the item's `icon` in a brand-gradient tile (`--brand-from` / `--brand-to` tokens) and, from md
up, on list pages only, the section's motif from `apps/web/src/components/illustrations/index.ts`
(`NAV_ILLUSTRATIONS`, a `Record<NavItemId, …>`, so a new nav id without art fails the typecheck; state scenes in
`STATE_ILLUSTRATIONS`); detail pages keep the section's icon but no motif, and their long title wraps.
Copy that names another page reads the sidebar label with `navLabel(id)` (`lib/nav.ts`); the requests metric is
"API calls" everywhere (`METRIC_COPY.requests.label`); chart descriptions name the grain with `perGrain`
(`lib/format.ts`); business empty states link the guide with `components/GuideLinkButton.tsx`. The top bar
height is the `--spacing-topbar` token (`md:h-topbar`); the person identity card sticks at `top-below-topbar`.
Decorative art: inline SVG drawn only with token utilities (`fill-primary/…`, `stroke-border`, `fill-chart-…`),
always `aria-hidden` (`IllustrationFrame`). Empty, error, admins-only, no-access and not-found states open with
`apps/web/src/components/StateArt.tsx` (a small scene plus a badge with the state's own icon). Major panels may
pass `icon` to `Panel` (size-4, muted, aria-hidden). Favicon: `apps/web/src/app/icon.svg` (plum "L" mark).
Operating systems print through `formatOsName` (`apps/web/src/lib/format.ts`): every macOS form reads "macOS"
(display only; the stored `ua_os` is unchanged). Empty times print alone (`withUnit`: "—", never "— IST").
`apps/web/src/components/AppShell.tsx` wraps every page in `PageEndProvider` (`apps/web/src/components/PageEndProvider.tsx`)
and renders `apps/web/src/components/PageEnd.tsx` under it: "Still loading…" during a first load, "More rows
above" while a `LoadMoreButton` list has more (`useOpenListMarker`), else "End of <page>". The `today` preset
(`RANGE_VALUES`) resolves in `packages/shared/src/time-window.ts` (`resolveTimeWindow`; `elapsedTo` for
comparisons and gap filling, `wholeReportingDays` for the person page's Daily activity). The sidebar brand is `apps/web/src/components/LibasLogo.tsx` (mask of
`public/brand/libas-logo.png`); the light under the mouse on cards is `apps/web/src/components/CursorSpotlight.tsx`
(mounted in `AppProviders`, CSS `::after` in `globals.css`). Light is the default theme; sidebar colours are the
`--sidebar*` tokens in `globals.css`.

Shared UI of these pages: `components/ActivityEvent.tsx` (timeline/replay row), `components/RankedList.tsx`,
`components/charts/RankedBarChart.tsx`, `components/charts/Sparkline.tsx`; `formatCountry` / `formatElapsed`
in `lib/format.ts`.

### 5c. The live chain (S4): Live page

Two halves meet in the cached snapshot: REST backfills it from the DB, Socket.io keeps it moving.

```
apps/web/src/features/live/LiveView.tsx          tiles (latest tick) + TrafficChart (ticksToPoints) + streaming DataTable, pause/resume
apps/web/src/features/live/useLiveFeed.ts        snapshot + socket: subscribe → ticks → upsertTick (liveBuffer.ts) → setQueryData;
                                                 events → mergeEvents (≤ LIVE_FEED_BUFFER); session end → endLiveSession (reload → proxy login)
apps/web/src/features/live/useLiveSnapshot.ts    useQuery(qk.live.snapshot(f)) → api.live.snapshot → ROUTES.live.snapshot
apps/api/src/http/controllers/live.controller.ts LiveController.snapshot (no-store) → LiveService.snapshot
apps/api/src/services/live.service.ts            ApiRequestQueryRepository.timeseries(minute) + WebEventQueryRepository.activityTimeseries /
                                                 listRecentEvents / countActiveUsers → domain/live-ticks.ts toLiveTicks + mapLiveEvent (IP admin-only)
apps/web/src/lib/socket.ts                       createLiveSocket: io(origin + SOCKET_NAMESPACES.live, { path: NEXT_PUBLIC_SOCKET_PATH })
apps/api/src/socket.ts                           createRealtime: allowRequest (live/socket-origin.policy.ts) → socketAuth (live/socket-auth.middleware.ts)
                                                 → LiveSubscriptionHandler (joins liveRoom(filter, role)) → LiveTickScheduler
ingest: IngestService.publishLive → LiveFeed.record* → LiveWindow.record* + LiveBroadcaster.enqueue
timers: LIVE_TICK_MS → LiveBroadcaster.emitTicks (traffic:tick per subscribed scope) · LIVE_EVENTS_FLUSH_MS → flushEvents
        (traffic:events, admin room with IP / viewer room withoutIp) · LIVE_SESSION_SWEEP_MS → LiveSessionSweeper.sweep (live:session-expired)
```

Dev: `NEXT_PUBLIC_SOCKET_PATH=/traffic/socket.io` everywhere; `next dev` rewrites it to the api (`next.config.ts`),
nginx does in production. Proven by `apps/api/test/e2e/live-socket.test.ts` (real socket, tick ≤ `LIVE_TICK_MS`).

**Who's online** (`ROUTES.live.online`, GET `/v1/live/online`, query `liveOnlineQuerySchema` {app?, userKey?}):
`features/live/useOnlineNow.ts` (polls every 15 s while visible) → `api.live.online` → `LiveController.online` →
`LiveService.online` → `WebEventQueryRepository.countOnlineByApp` + `listOnlineUsers` — always the last
`ACTIVE_USER_WINDOW_MS` on both tables; one row per (app, verified user) with the newest action (templates, never raw
paths; `page_time` flushes rank last), current page and event count. Shown by `features/live/OnlineNowPanel.tsx` (Live),
the "Online now" column (`features/applications/appTrafficColumns.tsx`), and `features/users/OnlineBadge.tsx`.

### 5d. Background jobs (S6): partitions + retention

```
apps/api/src/server.ts               startJobs(container) after listen; createShutdown({ jobs, … }) on SIGTERM/SIGINT
apps/api/src/jobs/scheduler.ts        every(name, ms, run): explicit list, no overlap per job, unref'd timers,
                                      failures logged ('job failed'); stop() clears timers + awaits runs in flight
  ├─ every 6 h      → apps/api/src/jobs/partition-maintenance.job.ts  PartitionMaintenanceJob.run
  └─ every 15 min   → apps/api/src/jobs/retention.job.ts              RetentionJob.run (works once per IST day, 02:30–03:30)
both: apps/api/src/db/transaction.ts withAdvisoryXactLock(pool, ADVISORY_LOCKS.x, client => …)   (other replica holds it → skip)
apps/api/src/services/partition.service.ts   ensureAhead(client) / dropExpired(client)  — the work runs on the LOCKED client
apps/api/src/repositories/partition.repository.ts   ensure / dropExpired → SELECT traffic.ensure_partitions(1, 2) /
                                      traffic.drop_expired_partitions(table, RAW_RETENTION_MONTHS)
retention, then (same lock): apps/api/src/services/aggregate-retention.service.ts  AggregateRetentionService.deleteExpired(exec)
  → apps/api/src/repositories/aggregate-retention.repository.ts  AggregateRetentionRepository.deleteExpired(cutoff, exec)
    (DELETE … WHERE bucket_hour < now − AGGREGATE_RETENTION_DAYS on AGGREGATE_TABLES; logged as deletedAggregates)
apps/api/migrations/0001_helpers_and_partitions.sql   the SECURITY DEFINER functions (nexus_app has no DDL of its own)
apps/api/src/lifecycle/shutdown.ts    realtime.close → server.close → jobs.stop() → pools.end (10 s failsafe)
```

Proven by `apps/api/src/jobs/*.test.ts`, `apps/api/src/lifecycle/shutdown.test.ts` and
`apps/api/test/db/retention-job.integration.test.ts` (real container, `RAW_RETENTION_MONTHS=1`, back-dated
partitions, as `nexus_app`: only the expired months are dropped).

## 6. How to find X

| I want… | Go to |
|---|---|
| the handler of a path | Shift+F12 on the `ROUTES` leaf → `apps/api/src/http/routes/index.ts` |
| who emits / listens to a socket event | Shift+F12 on the `SOCKET_EVENTS` key → `apps/api/src/live/*` and `apps/web/src/features/live/useLiveFeed.ts` |
| the SQL behind a service | the `@see` lines on the service method |
| a table's columns and CHECKs | `apps/api/migrations/` + [07-data-model.md](07-data-model.md) |
| what other teams send | `packages/shared/src/ingest/schemas.ts` + [08-integration-contract.md](08-integration-contract.md) |
| how a class is constructed | `apps/api/src/container.ts` |
| which env vars exist | `apps/api/src/config/env.schema.ts` (`.env.example` is generated from it) |
| a background job | `apps/api/src/jobs/scheduler.ts` (the explicit list), §5d |
| how to deploy / back up / restore | `DEPLOY.md` (repo root), `ops/backup/run.sh`, `ops/backup/restore.sh` |
