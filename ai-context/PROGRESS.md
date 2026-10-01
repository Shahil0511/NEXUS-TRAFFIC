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

## 2026-10-01 — ADR 0002 (external database) + S1 carry-over fixes

**Done**
- **Role modes** (`DB_APP_ROLE_MODE = separate | owner`, default `separate`): `apps/api/src/db/migrate-config.ts`
  (`NEXUS_APP_DB_PASSWORD` required ≥ 16 chars ONLY in `separate`, one-line error naming the key; `appRoleOf()`),
  `apps/api/src/db/migration-runner/bootstrap.ts` (`bootstrapDatabase(pool, appRole)`; `owner` = schema + ledger
  only, never touches a role; password safety unchanged). Production on 10.150.0.5 / `nexus_traffic` runs `owner`
  (`DATABASE_URL` = `MIGRATION_DATABASE_URL`); localdb, CI and the DB suites run `separate`.
- **Grants moved out of migrations:** `0007_grants.sql` deleted; the same statements live in
  `apps/api/src/db/migration-runner/grants.ts`, applied by the runner after the migrations (apply mode,
  `separate` only, one transaction under the migrate advisory lock, before the partitions). Idempotent: a
  revoked grant is repaired on the next run. Runner option `appPassword` → `appRole`.
- **Compose:** `postgres` only with profile `localdb`; `postgres:18-alpine` via the `x-pg-image` anchor
  (`PG_IMAGE` overridable); volume at `/var/lib/postgresql` (PG18 image layout, verified in the image:
  `PGDATA=/var/lib/postgresql/18/docker`, `VOLUME /var/lib/postgresql`); `migrate` / `pg-backup` use
  `depends_on … required: false`; `DB_APP_ROLE_MODE` passed to migrate; `NEXUS_APP_DB_PASSWORD` optional.
  `pg-backup` dumps `BACKUP_DATABASE_URL` (default `MIGRATION_DATABASE_URL`) with `pg_dump … -Fc`
  (`ops/backup/run.sh`, restore = `pg_restore -d "$BACKUP_DATABASE_URL"`).
- **Env + preflight:** `.env.example` regenerated (database section with both modes, URL-encoding note,
  placeholders only; `POSTGRES_*` marked localdb-only; `BACKUP_DATABASE_URL`); `scripts/preflight.sh`
  gained `--localdb`, mode-aware required keys, hex check only for the three HMAC secrets (+ the app password
  in `separate`), owner-mode URL identity, raw-`@` detection, and a TCP check of the DB host:port (skipped for
  the `postgres` service).
- **S1 fixes:** error handler delegates to `next(err)` once headers were sent; `serverIngestJsonBody` reads the
  media type from the `Content-Type` header, so an empty JSON body reaches the envelope validation, which now
  answers `400 INVALID_ENVELOPE` (as the guide documented; `docs/CHANGELOG.md`); `PartitionService.ensureAhead/
  dropExpired(exec?)` and both jobs run their work on the advisory-locked client; `RetentionJob` takes
  `ADVISORY_LOCKS.retention` (write pool injected in `container.ts`) and retries on the next tick after a failure.
  Documentation IP ranges stay `public` (comment in `ip.anonymizer.ts`).
- **Docs:** ADR 0001 "Postgres / roles" row points to ADR 0002; 02-architecture (container table + mermaid),
  03-code-navigation, 06-process (two ways to run), 07-data-model (roles), GLOSSARY, `apps/api/migrations/README.md`.
- **Tests:** api 534 with `RUN_DB_TESTS=1` on **PostgreSQL 18.6** and on **17** (440 unit + 94 DB/e2e; shared 28, auth 10), new:
  owner-mode suite (restricted login without CREATEROLE: bootstrap + migrations create/alter no role, no grants,
  api runs as the owner), grants re-applied idempotently, status/dry never touch grants, migrate-config modes,
  job/advisory-lock tests with a fake pool, empty-body tests (incl. a raw request without Content-Length).
- **Rehearsal (fully local, PG18):** old PG17 volume removed (`down -v`), `.env` regenerated for localdb
  (separate mode, fresh hex secrets), `docker compose --profile localdb --profile local up -d --build` → migrate
  exit 0 (6 migrations, grants, 8 partitions), `/api/health/ready` 200 on :4005 and `/traffic/api/health` 200 on
  :8080, manual `pg-backup --once` OK, `docs/snippets/curl.sh` with a fresh key: verify 200, dry run 202, send
  `accepted:1`, resend `duplicates:1`; then `down` (volume kept).

**Next:** the TL runs `migrate` against 10.150.0.5 / `nexus_traffic` in `owner` mode (first production deploy),
then S2.

**Notes / known issues**
- The comments of migrations `0001`/`0003` still mention `0007_grants.sql`; left as is (editing an applied file
  is checksum drift). A database migrated by an S1 rehearsal lists `0007_grants` as unknown-applied (warning).
- `deploy.sh` runs `--remove-orphans` and the production preflight (no `--localdb`); it is meant for the
  external-database deploy only.

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
