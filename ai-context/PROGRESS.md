# PROGRESS — living log

Newest entry first. Each implementation step (S0–S6, see the plan summary below) adds one entry:
date, what was done, files touched, what's next, known issues.

## Plan summary

| Step | Delivers |
|---|---|
| S0 | Foundation: monorepo, `@nexus/shared` contracts, `@nexus/auth`, ai-context |
| S1 | DB migrations + API skeleton + server ingest + app/key admin API + docs skeleton + Docker/compose |
| S2 | Dashboard shell + SSO + Overview / API Routes / Errors |
| S3 | Browser ingest + `@nexus/react` + Users / Journeys / Pages & Tools / Geography |
| S4 | Socket.io live + Live page |
| S5 | Reference SDK packages, snippets, tarballs, full guide, Integration Health, Apps admin UI |
| S6 | Retention/partition jobs, backups, nginx + DEPLOY.md, security suite, polish, push `main` |

---

## 2026-10-01 — S1 Database, server ingest, key admin, docs skeleton, Docker

**Done**
- **Database** (`apps/api/migrations/0001`–`0007`, see `apps/api/migrations/README.md` and
  [07-data-model.md](07-data-model.md)): helpers + monthly partition functions, apps/api_keys, append-only
  admin audit log, `api_requests`, `web_events` (schema only), `ingest_counters` (IST hour buckets),
  grants for `nexus_app` (DML only). Migration runner + CLI (`apps/api/src/db/migrate.ts`, exit codes
  ok 0 / failed 1 / drift 2), bootstrap of `nexus_app`, schema guard (api refuses to start if behind).
- **Server ingest** (`POST /api/v1/ingest/server`, `GET /api/v1/ingest/verify`): key parse/hash/cache/
  authenticate, per-IP failure and per-key rate limits, enrichment (path, route template, IP + geo, UA,
  identity, user key, time window), `toApiRequestInsert`, idempotent batch insert, partition retry,
  poison-row bisect, dry run, counters. Chain: [03-code-navigation.md](03-code-navigation.md) §3.
- **App/key admin API** (`/api/v1/apps…`, SSO + `X-Nexus-Dashboard` + admin): list, create, update, create/
  expire/revoke key; one transaction + audit row per change; key cache invalidated after commit.
- **Docs**: public guide `docs/integration/` → `docs/dist` (`npm run docs:build`), OpenAPI
  (`npm run openapi:emit`), snippets in `docs/snippets/`, served by `DocsController` at `/api/docs/`.
- **Docker**: `apps/api/Dockerfile`, `docker-compose.yml` (postgres → migrate → api, edge with
  `--profile local`, pg-backup), `ops/nginx/`, `scripts/preflight.sh`, `scripts/deploy.sh`, generated `.env.example`.
- **Integration**: scaffolding marker removed; contract tests `apps/api/test/routes-contract.test.ts`
  (+ `EXPECTED_PENDING` for S2–S5 leaves) and `apps/api/test/no-scaffolding.test.ts`; in-process e2e
  `apps/api/test/e2e/ingest.integration.test.ts` (real container + app, admin routes → ingest over HTTP).
- **Tests**: api 407 unit (41 files) + 89 DB/e2e (6 files, `RUN_DB_TESTS=1`), shared 28, auth 10 — all green.
- **Rehearsal**: `docker compose --profile local up -d --build` → all healthy, migrate exit 0 (7 migrations,
  8 partitions); `/api/health`, `/api/health/ready`, `/traffic/api/health` 200; `/traffic/api/docs` 308 →
  `/traffic/api/docs/` 200; `docs/snippets/curl.sh` via edge: verify 200, dry run 202, send `accepted:1`,
  resend `duplicates:1`.

**Next (S2)**: `apps/web` shell + SSO + Overview / API Routes / Errors; query repositories on
`api_requests`; fill the dashboard section of [03-code-navigation.md](03-code-navigation.md); remove the
S2 leaves from `EXPECTED_PENDING`.

**Notes / known issues**
- **ADR 0002 (external database on 10.150.0.5, `DB_APP_ROLE_MODE=owner|separate`, compose `localdb`
  profile, Postgres 18 images) is NOT implemented yet.** S1 still ships the original design: compose
  `postgres:17-alpine` service and a mandatory `nexus_app` role created by the migrate bootstrap.
  Production deploy needs that ADR implemented first (env schema, bootstrap, compose, backups).
- DB column lengths with no `INGEST_LIMITS` constant (ua_*, geo_region/city, sdk, …) are fixed in the
  migrations only (the UA parser clamps browser/os to 128 via `UA_FACET_MAX_LENGTH`). Suggested contract
  change: add them to `INGEST_LIMITS` so the parity test checks them.
- `clock_skew_ms` is `bigint` and `geo_country` is `text` + CHECK (departures from the plan, see 07-data-model).
- `PartitionMaintenanceJob` takes the advisory lock on a client but `PartitionService.ensureAhead` runs on
  the pool (harmless: the SQL functions are race-safe). Fix in S6 with the jobs work.
- `error-handler.middleware.ts` returns early (instead of `next(err)`) when headers were already sent;
  `serverIngestJsonBody` answers 415 rather than 400 for an empty body with `Content-Type: application/json`.
- 203.0.113.0/24 (TEST-NET, used by the examples) is classed `public` by `classifyIp` and has no geo.
- The OpenAPI error envelope is a script-local zod schema; an exported `apiErrorBodySchema` in shared would
  remove the copy. No `scripts/tsconfig.json` yet (scripts are type-checked only ad hoc).
- `ai-context/08-integration-contract.md` lists other teams' file paths; the planned ai-context
  doc-link test (not written yet) must exempt that table.

---

## 2026-10-01 — S0 Foundation

**Done**
- Monorepo (npm workspaces `packages/*`, `apps/*`), `tsconfig.base.json` with `customConditions: ["@nexus/source"]`
  (ctrl-click into shared opens `src/`), prettier, git (`main`), `.gitattributes` (LF everywhere).
- `@nexus/shared`: `routes.ts` (ROUTES, buildPath), `events.ts` (socket contract), `errors.ts`,
  `constants/*` (enums mirrored by DB CHECKs, key format, ingest limits, time/range rules),
  `ingest/*` (contract v1 zod schemas, examples, `resolveClientIp`, `buildIngestUrl`),
  `schemas/*` (dashboard query/admin schemas), `dto/*`, `time-window.ts`, `endpoint-id.ts` (node-only).
- `@nexus/auth`: `verifyAccessToken` (HS256, pinned alg, exp/nbf/type), `extractEmail`, `readCookie`,
  `verifyAccessTokenCookie`, `decideDashboardAccess`.
- Tests: 28 shared + 10 auth, all green; both packages build to CJS `dist/`.
- ai-context: README, overview, architecture, conventions, glossary, ADR 0001, this log.

**Next (S1)**: migrations + migration runner, API skeleton (config, container, errors, logger), server ingest,
app/key admin endpoints, Dockerfile + compose (postgres, migrate, api), docs page skeleton.

**Notes / known issues**
- `package-lock.json` was first generated on Windows; regenerate it inside `node:22-alpine` before the
  first Docker build (Linux musl optional binaries).
- `toEndpointId` lives in `@nexus/shared/endpoint-id` (node-only, not in the root barrel).
