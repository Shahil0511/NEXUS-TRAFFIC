# 03 — code navigation

Where to start reading code, which folder is which layer, and the chains that exist: server ingest
and app/key admin (S1, admin UI + Integration Health in S5 §4/§4b), the dashboard read side UI → SQL for Overview / API Routes / Errors (S2) and the following pages (S3–S5), and the background jobs (S6, §5d). See [README.md](README.md) for the reading order and [PROGRESS.md](PROGRESS.md)
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
| `auth/` | key + SSO auth | parse / hash / generate / cache keys; read the SSO cookie |
| `domain/` | types + pure rules | `rows.ts`, `inserts.ts`, `viewer.ts`, `mappers.ts` (row → DTO, IP admin-only), `to-api-request-insert.ts` / `to-web-event-insert.ts` (wire → row), `base-path.ts` (browser base-path rule), `browser-sdk.ts`; read side: `filters.ts` (repository inputs), `compute-deltas.ts` (KPI deltas), `timeseries-gaps.ts` (zero-filled IST buckets), `session-replay.ts` (API calls interleaved into a replay), `pagination.ts` (limit + 1, cursors), `numbers.ts` (rounding) |
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
  apps/api/src/http/middleware/rate-limit.middleware.ts    keyRateLimitMiddleware     (per key id)
  apps/api/src/http/middleware/validate.middleware.ts      validateBody(serverIngestEnvelopeSchema)
apps/api/src/http/controllers/ingest.controller.ts  IngestController.server  (?dryRun=1, X-Nexus-Contract header)
apps/api/src/services/ingest.service.ts             IngestService.ingestServerEvents
  per event: serverEventSchema → enrichment/event-time.guard.ts → ServerEventEnricher.enrich
apps/api/src/enrichment/server-event.enricher.ts    path.sanitizer → route.normalizer → ip.anonymizer → geo-ip.enricher
                                                    → user-agent.parser → identity.resolver → user-key.hasher
                                                    → toEndpointId (@nexus/shared/endpoint-id)
apps/api/src/domain/to-api-request-insert.ts        toApiRequestInsert(event, enrichment) → ApiRequestInsert
apps/api/src/repositories/api-request-ingest.repository.ts  ApiRequestIngestRepository.insertBatch
                                                    (unnest INSERT … ON CONFLICT DO NOTHING RETURNING event_id)
apps/api/migrations/0004_api_requests.sql           traffic.api_requests (monthly partitions, CHECKs = shared limits)
  then: repositories/ingest-counter.repository.ts (0006) and live/live-feed.ts
```

Failure paths: a missing partition triggers `PartitionRepository.ensure` and ONE retry; a CHECK
violation bisects the batch so only the bad rows come back as `DB_CONSTRAINT`; DB unavailable → 503
`INGEST_UNAVAILABLE` with Retry-After. `GET /api/v1/ingest/verify` runs `anyKeyAuthMiddleware` →
`IngestController.verify` → `IngestService.verify` (no DB write besides the usage touch).

### 3b. The browser ingest chain (`POST /api/v1/ingest/browser`, S3)

Same storage path as §3, but the key is in the BODY (sendBeacon sends `text/plain`, no custom headers),
so auth runs after parsing; the actor (identity, IP, geo, UA) is resolved ONCE per beacon.

```
packages/shared/src/routes.ts                       ROUTES.ingest.browser = { method: 'POST', path: '/v1/ingest/browser' }
apps/api/src/http/routes/index.ts                   r.use(path, browserIngestPreflight)  (OPTIONS only: 204, reflects a
                                                    registered origin — AppRepository.anyAllowsOrigin)
                                                    r.post(ROUTES.ingest.browser.path, …chain…, ctl.ingest.browser)
  apps/api/src/http/middleware/rate-limit.middleware.ts      ipFailureLimitMiddleware (own instance: browserIpFailureLimit)
  apps/api/src/http/middleware/beacon-body.middleware.ts     beaconBodyMiddleware     (text/plain | application/json, 60 KiB)
  apps/api/src/http/middleware/parse-beacon-json.middleware.ts  parseBeaconJsonMiddleware (malformed → INVALID_ENVELOPE)
  apps/api/src/http/middleware/validate.middleware.ts        validateBody(browserIngestEnvelopeSchema)
  apps/api/src/http/middleware/ingest-auth.middleware.ts     publishableKeyAuthMiddleware (body `key`; AppKeyAuthenticator
                                                    with 'publishable': secret → markExposed + 403 SECRET_KEY_EXPOSED,
                                                    APP_DISABLED; then 403 BROWSER_INGEST_DISABLED)
  apps/api/src/http/middleware/browser-ingest-cors.middleware.ts  browserIngestCorsMiddleware (reflects Origin only if in
                                                    app.allowed_origins, with credentials; never *)
  apps/api/src/http/middleware/origin-guard.middleware.ts    originGuardMiddleware   (Origin decides; 'null' rejected; Referer
                                                    only when Origin is absent; neither → 403 ORIGIN_NOT_ALLOWED)
  apps/api/src/http/middleware/rate-limit.middleware.ts      keyRateLimitMiddleware (INGEST_RATE_LIMIT_BROWSER_PER_MIN) →
                                                    sessionRateLimitMiddleware (app + sessionId, …_PER_SESSION_PER_MIN)
apps/api/src/http/controllers/ingest.controller.ts  IngestController.browser  (req.ip, User-Agent, Cookie → BrowserRequestInfo;
                                                    sdk = domain/browser-sdk.ts browserSdkOf(envelope.client))
apps/api/src/services/ingest.service.ts             IngestService.ingestBrowserEvents
  once:      BrowserEventEnricher.enrichActor → identity.resolver forBrowser (SSO cookie → sso_cookie; else user.email hint →
             client_claimed = claimed_email ONLY; user_key only for sso_cookie) → ip.anonymizer / geo-ip / user-agent
  per event: browserEventSchema → event-time.guard → domain/base-path.ts isWithinBasePath (PATH_OUTSIDE_APP)
             → BrowserEventEnricher.enrich (path.sanitizer for path + referrerPath → route.normalizer)
apps/api/src/enrichment/browser-event.enricher.ts   (actor columns shared with the server path: enrichment/actor-columns.ts)
apps/api/src/domain/to-web-event-insert.ts          toWebEventInsert(event, enrichment) → WebEventInsert
apps/api/src/repositories/web-event-ingest.repository.ts  WebEventIngestRepository.insertBatch (same unnest + ON CONFLICT)
apps/api/migrations/0005_web_events.sql             traffic.web_events
  then: ingest-counter.repository.ts (source 'browser') and LiveFeed.recordWebEvents
```

Dedupe, partition retry, poison-row bisect and 503 are the SAME code as §3 (`IngestService.storeBatch`,
generic over the row type). `GET verify` accepts the publishable key too (`anyKeyAuthMiddleware`).

## 4. The app/key admin chain (`/api/v1/apps…`)

```
packages/shared/src/routes.ts                       ROUTES.apps.{list, create, update, createKey, expireKey, revokeKey}
apps/api/src/http/routes/index.ts                   dashboard = [ssoAuth, dashboardCsrf]; admin = [...dashboard, requireAdmin]
  apps/api/src/http/middleware/sso-auth.middleware.ts      access_token cookie → Viewer (auth/sso-identity.reader.ts,
                                                           auth/dashboard-access.policy.ts)
  apps/api/src/http/middleware/dashboard-guards.middleware.ts  X-Nexus-Dashboard: 1 (CSRF) + requireAdmin
  dashboardJsonBody → validateParams / validateBody (packages/shared/src/schemas/apps.ts)
apps/api/src/http/controllers/app.controller.ts     AppController.<leaf>
apps/api/src/services/app-query.service.ts          AppQueryService.list   → AppRepository.list + ApiKeyRepository.listByAppIds
apps/api/src/services/app-admin.service.ts          AppAdminService.create / update / createKey / expireKey / revokeKey
  one transaction each (db/transaction.ts): AppRepository / ApiKeyRepository + AdminAuditRepository.record,
  then AppKeyCache.invalidateApp after COMMIT; createKey uses auth/api-key.generator.ts (plaintext shown once)
apps/api/src/domain/mappers.ts                      mapApp / mapApiKey → AppDto / ApiKeyDto (never key_hash)
apps/api/migrations/0002_apps_and_api_keys.sql      traffic.apps, traffic.api_keys
apps/api/migrations/0003_admin_audit_log.sql        traffic.admin_audit_log (append-only for nexus_app)
```

Web half (S5, admins only; non-admins get `components/AdminOnly.tsx` from the `useMe` flag):
`app/(dashboard)/apps/page.tsx` (passes NEXUS_URL from the server env) → `features/apps/AppsView.tsx` →
`AppCard.tsx` (settings, integration values, key table `keyColumns.tsx`) + dialogs `AppFormDialog.tsx`
(create/update, validated with the shared schemas in `appForm.ts`), `CreateKeyDialog.tsx` (one-time reveal +
copy; the plaintext lives only in component state, mutation `gcTime: 0` + `reset()`), `KeyActionDialog.tsx`
(expire with a grace period / revoke, in-page confirm) → `useAppMutations.ts` (invalidates `qk.apps.all` +
`qk.integration.all`) → `api.apps.<leaf>` (`lib/api.ts`, sends `X-Nexus-Dashboard: 1`).

### 4b. The Integration Health chain (S5, `GET /api/v1/integration/health`)

```
apps/web/src/features/integration/IntegrationView.tsx   tallies (KpiCard) + AppHealthCard per app (global ?app= narrows client-side)
apps/web/src/features/integration/integrationCopy.ts    warning/status copy + guide chapter (lib/guide.ts guideHref → /traffic/api/docs/#…)
apps/web/src/features/integration/useIntegrationHealth.ts  useQuery(qk.integration.health()) → api.integration.health
packages/shared/src/routes.ts                           ROUTES.integration.health (...dashboard, any viewer)
apps/api/src/http/controllers/integration.controller.ts IntegrationController.health (private, max-age=15)
apps/api/src/services/integration.service.ts            IntegrationService.health: window = INTEGRATION_HEALTH_WINDOW_MS, rows per app
apps/api/src/domain/integration-health.ts               integrationStatusOf / privateIpRatioOf / countersBySource / integrationWarningsOf
                                                        (thresholds: packages/shared/src/constants/integration.ts)
apps/api/src/repositories/ingest-health.repository.ts   IngestHealthRepository.perApp (QUERY pool, 5 reads in parallel): apps + newest
                                                        event per source (DESC LIMIT 1), Σ ingest_counters, SDK stats per table
                                                        (percentile_cont skew; private-IP counts on api_requests only), exposed live keys
apps/api/src/domain/mappers.ts                          mapIngestCounter / mapSdkHealth / mapExposedKey → shared dto/integration.ts
```

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
apps/web/src/features/endpoints/EndpointsView.tsx      table + RangePicker; const q = useEndpointStats(…)
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
| `overview.timeseries` | `OverviewController.timeseries` / `OverviewService.timeseries` | `ApiRequestQueryRepository.timeseries`, `WebEventQueryRepository.pageViewTimeseries` | `bucketExpr` (IST) in `apps/api/src/db/sql.ts`; gaps → `domain/timeseries-gaps.ts` |
| `endpoints.list` | `EndpointController.list` / `EndpointService.list` | `listEndpointStats` | offset cursor (`encodeOffsetCursor`) |
| `endpoints.detail` | `EndpointController.detail` / `EndpointService.detail` | `getEndpointDetail` | by stored `endpoint_id`; 404 when no rows; slowest samples role-masked; unique users + top callers (`listTopUsers`) |
| `errors.summary` | `ErrorController.summary` / `ErrorService.summary` | `summarizeErrors` | totals, by status, series, top failing endpoints, users affected; optional `endpointId` / `userKey` scope |
| `errors.list` | `ErrorController.list` / `ErrorService.list` | `listFailures` | keyset `(occurred_at, event_id)` DESC; counts cap `MAX_COUNT_RANGE_MS` |

Read-side rules (all in `apps/api/src/repositories/api-request-query.repository.ts`): every query is
bounded by `occurred_at >= from AND < to` (partition pruning); failure filters emit the partial-index
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
| `users.list` | `UserController.list` / `UserService.list` | `listUsers` | verified only (`user_key IS NOT NULL`), both tables, offset cursor; `sessions` = browser sessions; `sort`/`dir` whitelist `USER_ORDER_SQL` |
| `users.activity` | `.activity` | `listDailyUsers`, `countIdentifiedUsers` | DAU per IST day (gap-filled, `fillCountGaps`) + WAU/MAU ending at the window end; registered before `/:userKey` |
| `users.search` | `UserController.search` / `UserService.search` | `listUsers` | **POST** body `userSearchBodySchema` — the email never travels in a URL (ADR 0006) |
| `users.profile` | `.profile` | `getUserProfile` + `ApiRequestQueryRepository.listUserTopEndpoints` | by stored `user_key` (hex in the URL → `userKeyFromHex`); 404 when no rows; per-app activity (`listUserApps`) |
| `users.timeline` | `.timeline` | `listUserTimeline` | API ∪ browser, keyset `(occurred_at, event_id)` DESC; IP admin-only |
| `journeys.sessions` | `JourneyController.sessions` / `JourneyService.sessions` | `listSessions` | strongest identity (`IDENTITY_RANKS`), entry/exit page, optional `userKey`, offset cursor |
| `journeys.session` | `.session` | `getSession` | see above |
| `journeys.topPaths` | `.topPaths` | `listTopPaths` | 3-step `lead()` over page views, reloads collapsed; 31-day cap |
| `pages.list` | `PageController.list` / `PageService.list` | `listPageStats` | Σ `visible_ms` per page view → avg / p50 (31-day cap), exits, distinct users; `pageId` = `toPageId` |
| `pages.detail` | `.detail` | `listPageTemplates` → `getPageDetail` + `ApiRequestQueryRepository.listPageApiCalls` | opaque `pageId` resolved in the service ([ADR 0007](decisions/0007-page-and-tool-ids-and-drill-downs.md)); trend, viewers, tools, came from / went to |
| `tools.usage` | `ToolController.usage` / `ToolService.usage` | `listToolUsage` | top tools + trend of those tools; gaps → `fillToolTrendGaps`; `toolId` = `toToolId` |
| `tools.detail` | `.detail` | `listToolNames` → `getToolDetail` | opaque `toolId` resolved in the service; users, pages, actions |
| `geo.countries` / `geo.cities` | `GeoController` / `GeoService` | `listCountries` / `listCities` | API calls + page views per location (`geoStatement`) |

Non-paged lists (top paths, pages, tools, geo) return `WindowedListDto<T>` = `{ window, items }`.
`page_time` rows carry visible-ms DELTAS: the time of a page view is Σ `visible_ms` of the `page_time`
rows whose `page_view_id` is its `event_id` (`pageViewVisibleMs`); timelines and replays fold them into
the page view and never list them.

Web half (page → View → hook → `api.*`; every View reads the global filters from `useGlobalFilters`):

| Page (`apps/web/src/app/(dashboard)/…`) | View (`apps/web/src/features/…`) | Hook(s) → `api.*` | Notes |
|---|---|---|---|
| `users/` | `users/UsersView.tsx` | `useUserList` → `users.list`, `useUserSearch` → `users.search` | search text in React state only (never the URL); "Load more"; link `PAGES.userDetail(userKey)`, app chips |
| `users/[userKey]/` | `users/UserDetailView.tsx` | `useUserProfile` → `users.profile`, `useUserTimeline` → `users.timeline` | `userKeyParamsSchema` → 404; timeline columns in `userTimelineColumns.tsx` |
| `journeys/` | `journeys/JourneysView.tsx` | `useTopPaths` → `journeys.topPaths`, `useSessionList` → `journeys.sessions` | `?userKey=` (`useSessionListParams`, from a profile's "View sessions"); `ClaimedBadge` via `ActorCell` |
| `journeys/[app]/[sessionId]/` | `journeys/SessionDetailView.tsx` | `useSessionDetail` → `journeys.session` | see the chain above |
| `pages/` · `tools/` | `pages/PagesView.tsx` · `tools/ToolsView.tsx` | `usePageStats` → `pages.list` · `useToolUsage` → `tools.usage` | ONE nav entry ("Pages & Tools", `alsoActiveOn`); `PagesToolsTabs` switches routes |
| `pages/[app]/[pageId]/` · `tools/[app]/[toolId]/` | `pages/PageDetailView.tsx` · `tools/ToolDetailView.tsx` | `usePageDetail` → `pages.detail` · `useToolDetail` → `tools.detail` | params validated with the API's schemas → 404; `PageLink` / `ToolLink` (`components/EntityLinks.tsx`) link every listed page/tool here |
| `geography/` | `geography/GeographyView.tsx` | `useGeoCountries` → `geo.countries`, `useGeoCities` → `geo.cities` | `RankedBarChart`; cities labelled approximate; GeoLite2 attribution |

| `applications/` | `applications/ApplicationsView.tsx` | `useAppTraffic` → `overview.apps` | per-app table (`appTrafficColumns.tsx`); the app filter is hidden here |
| `applications/[app]/` | `applications/ApplicationDetailView.tsx` | `useAppTraffic`, `useOverviewTimeseries`, `useErrorSummary`, `useUserList`, `useEndpointStats`, `usePageStats`, `useToolUsage` | `appSlugSchema` → 404; the PATH app overrides the global filter; keyed by app in the page file |

Drill-down helpers: `components/TopUsersList.tsx` (any `UserUsageDto[]`), `components/charts/CountChart.tsx`
(one count over time), `features/users/useUserListParams.ts` (`?sort=&dir=`), `?userKey=` on Errors
(`features/errors/useErrorListParams.ts`).

Navigation helpers: `components/CommandPalette.tsx` (Ctrl/⌘+K, mounted in `AppShell` TopBar),
`components/AppChip.tsx` (app → its page), `UserLink` in `components/ActorCell.tsx` (verified user → profile),
`components/RelativeTime.tsx`, `lib/useDocumentTitle.ts` (masked emails only), `NavItem.filters` +
`pageFiltersFor` in `lib/nav.ts` (which global filters a page shows, and its range cap).

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
