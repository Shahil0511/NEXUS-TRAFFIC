# 03 — code navigation

Where to start reading code, which folder is which layer, and the chains that exist: server ingest
and app/key admin (S1), and the dashboard read side UI → SQL for Overview / API Routes / Errors (S2). See [README.md](README.md) for the reading order and [PROGRESS.md](PROGRESS.md)
for status.

## 1. Entry files

| File | What it is |
|---|---|
| `packages/shared/src/routes.ts` | `ROUTES`: every API path. Start every trace here (Shift+F12 on a leaf). |
| `packages/shared/src/ingest/schemas.ts` | The public ingest contract v1 (zod), plus `examples.ts`. |
| `apps/api/src/server.ts` | Process entry: config → container → schema guard → partitions → listen → jobs. |
| `apps/api/src/container.ts` | THE composition root; every class is built here once. |
| `apps/api/src/app.ts` | Express wiring (helmet, request id, access log, `/api` router, 404, errors). |
| `apps/api/src/http/routes/index.ts` | THE route table: path → middleware chain → controller method. |
| `apps/api/src/db/migrate.ts` | The `migrate` CLI (compose `migrate` service), see `apps/api/migrations/README.md`. Config + `DB_APP_ROLE_MODE`: `apps/api/src/db/migrate-config.ts`. |
| `apps/api/src/db/migration-runner/runner.ts` | One migrate run: bootstrap (`bootstrap.ts`) → plan → apply → `nexus_app` grants (`grants.ts`, separate mode only) → partitions. |
| `docker-compose.yml`, `apps/api/Dockerfile` | (postgres, `--profile localdb` only) → migrate → api → edge (`--profile local`), pg-backup. Production DB: external server (ADR 0002). |

## 2. Folder → layer map (`apps/api/src`)

| Folder | Layer | Rule |
|---|---|---|
| `http/routes/` | route table | only file that maps a `ROUTES` leaf to handlers |
| `http/middleware/` | cross-cutting HTTP | auth, CSRF, body parsing, validation, rate limits, errors |
| `http/controllers/` | HTTP adapters | arrow-property methods named like the `ROUTES` leaf; no logic |
| `services/` | use cases | orchestrate; method name = leaf name; `@see` to repositories |
| `enrichment/` | pure-ish transforms | one transformation per class; `ServerEventEnricher` orchestrates |
| `auth/` | key + SSO auth | parse / hash / generate / cache keys; read the SSO cookie |
| `domain/` | types + pure rules | `rows.ts`, `inserts.ts`, `viewer.ts`, `mappers.ts` (row → DTO, IP admin-only), `to-api-request-insert.ts` (wire → row); read side: `filters.ts` (repository inputs), `compute-deltas.ts` (KPI deltas), `timeseries-gaps.ts` (zero-filled IST buckets), `pagination.ts` (limit + 1, cursors), `numbers.ts` (rounding) |
| `repositories/` | SQL | one class per table concern; `@see ../../migrations/NNNN_x.sql` |
| `db/` | DB plumbing | pools, transactions, pg error classifiers, migration runner, schema guard |
| `jobs/` | timers | partition maintenance, retention (listed in `jobs/scheduler.ts`) |
| `live/` | realtime | `LiveFeed` buffer (Socket.io arrives in S4) |
| `config/`, `lib/`, `errors/`, `context/`, `lifecycle/` | infrastructure | env schema, logger, clock, `AppError`s, request context, shutdown |

Tests: unit tests sit next to the file (`*.test.ts`); DB suites are `*.integration.test.ts` and
self-skip unless `RUN_DB_TESTS=1`. Shared helpers live in `apps/api/test/` (`db/test-database.ts`
creates a fresh migrated database per suite). Contract tests: `apps/api/test/routes-contract.test.ts`
(every built leaf registered once, `EXPECTED_PENDING` lists what S2–S5 still add),
`apps/api/test/no-scaffolding.test.ts`, `apps/api/test/db/schema-parity.integration.test.ts`.
End to end: `apps/api/test/e2e/ingest.integration.test.ts` (S1) and
`apps/api/test/e2e/dashboard.integration.test.ts` (S2). The S2 read side is proven on a real database by
`apps/api/test/db/analytics-queries.integration.test.ts`; both S2 suites share the dataset in
`apps/api/test/db/analytics-seed.ts`.

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
| `overview.summary` | `OverviewController.summary` / `OverviewService.summary` | `ApiRequestQueryRepository.summarizeTraffic`, `WebEventQueryRepository.summarizePageViews` / `countActiveUsers` | current + previous window → `domain/compute-deltas.ts`; active users = last `ACTIVE_USER_WINDOW_MS` |
| `overview.timeseries` | `OverviewController.timeseries` / `OverviewService.timeseries` | `ApiRequestQueryRepository.timeseries`, `WebEventQueryRepository.pageViewTimeseries` | `bucketExpr` (IST) in `apps/api/src/db/sql.ts`; gaps → `domain/timeseries-gaps.ts` |
| `endpoints.list` | `EndpointController.list` / `EndpointService.list` | `listEndpointStats` | offset cursor (`encodeOffsetCursor`) |
| `endpoints.detail` | `EndpointController.detail` / `EndpointService.detail` | `getEndpointDetail` | by stored `endpoint_id`; 404 when no rows; slowest samples role-masked |
| `errors.summary` | `ErrorController.summary` / `ErrorService.summary` | `summarizeErrors` | totals, by status, series, top failing endpoints |
| `errors.list` | `ErrorController.list` / `ErrorService.list` | `listFailures` | keyset `(occurred_at, event_id)` DESC; counts cap `MAX_COUNT_RANGE_MS` |

Read-side rules (all in `apps/api/src/repositories/api-request-query.repository.ts`): every query is
bounded by `occurred_at >= from AND < to` (partition pruning); failure filters emit the partial-index
predicate `status_code >= 400` LITERALLY (`FAILURE_PREDICATES`, never a parameter); the keyset cursor
carries `occurred_at` as microsecond text (`keysetTimeExpr` in `apps/api/src/db/sql.ts`), because a JS
`Date` keeps only milliseconds and would repeat rows at page boundaries. Both query repositories run on
the read-only QUERY pool. IPs leave the API for admins only (`mapActor` in `apps/api/src/domain/mappers.ts`).

## 6. How to find X

| I want… | Go to |
|---|---|
| the handler of a path | Shift+F12 on the `ROUTES` leaf → `apps/api/src/http/routes/index.ts` |
| the SQL behind a service | the `@see` lines on the service method |
| a table's columns and CHECKs | `apps/api/migrations/` + [07-data-model.md](07-data-model.md) |
| what other teams send | `packages/shared/src/ingest/schemas.ts` + [08-integration-contract.md](08-integration-contract.md) |
| how a class is constructed | `apps/api/src/container.ts` |
| which env vars exist | `apps/api/src/config/env.schema.ts` (`.env.example` is generated from it) |
