# 04 — how to recipes

Step-by-step recipes for the usual changes. Order always follows rule 2 of `CLAUDE.md`: **shared contract
first**, then migration, then api, then web, then docs. Finish with the gates
([06-process.md](06-process.md)) and a [PROGRESS.md](PROGRESS.md) entry. See [README.md](README.md) for the
reading order.

## Add a dashboard metric or page

1. **Contract** (`packages/shared/src/`): a leaf in `routes.ts` (`ROUTES.<group>.<leaf>`), its query schema in
   `schemas/analytics.ts` (zod, `<leaf><Group>QuerySchema`), its DTO in `dto/<group>.ts` (`<Noun><Qualifier>Dto`).
2. **SQL**: a method on the query repository of the table (`apps/api/src/repositories/api-request-query.repository.ts`
   or `web-event-query.repository.ts`), named after what it reads, `exec = this.db` last, `@see` the migration.
   Every statement on `api_requests` / `web_events` must emit the environment predicate
   (`environmentConditions`, from the required `TrafficFilter.environments`; ADR 0008) — add the new
   method to the READS completeness table of the repository's test, which checks every `FROM` alias.
   A coverage-style number (identified, linked) uses `apps/api/src/repositories/coverage-predicates.ts`.
   Row type in `apps/api/src/domain/rows.ts`, row → DTO in `apps/api/src/domain/mappers.ts` (IP admin-only).
3. **Service**: method named like the leaf in `apps/api/src/services/<group>.service.ts`
   (`resolveTimeWindow` → `AppSlugResolver` → repository), `@see` the repository method.
4. **Controller + route**: arrow property named like the leaf in `apps/api/src/http/controllers/<group>.controller.ts`;
   register it in `apps/api/src/http/routes/index.ts` with `...dashboard` and `validateQuery(schema)`. New
   classes are built in `apps/api/src/container.ts`.
   **A read about ONE person** (a `:userKey` leaf, or a list that accepts `userKey`) is person-level
   ([ADR 0015](decisions/0015-admin-only-person-pages-and-access-log.md)): add it to `PERSON_ROUTE_LEAVES` (use `...admin`)
   or `PERSON_FILTERED_ROUTE_LEAVES` (add `mw.requireAdminForUserKey` after `validateQuery`) in
   `packages/shared/src/routes.ts`, give it a surface in `PERSON_ACCESS_SURFACE_VALUES` (and the CHECK of
   `traffic.person_access_log`, through a new migration), call `PersonAccessRecorder.record` after a successful
   read, cover it in `apps/api/test/person-access.routes.test.ts`, and keep its web query key out of auto-refresh
   (`apps/web/src/features/live/autoRefreshPolicy.ts`).
5. **Web**: `api.<group>.<leaf>` in `apps/web/src/lib/api.ts`, a key in `apps/web/src/lib/query/keys.ts`, a hook
   `apps/web/src/features/<group>/use<Thing>.ts` (one query), the view `<X>View.tsx`. A new page also needs
   `apps/web/src/app/(dashboard)/<page>/page.tsx`, a builder in `apps/web/src/lib/pages.ts` and a nav entry in
   `apps/web/src/lib/nav.ts` with `question` (one English sentence the page hero prints, ADR 0014 / 0016) and an
   `icon`, plus its hero art in `NAV_ILLUSTRATIONS` (`apps/web/src/components/illustrations/index.ts`; the
   typecheck fails without it). New art is an inline-SVG component in that folder, wrapped in `IllustrationFrame`
   and drawn with token utilities only (ADR 0016). An empty or error state uses `EmptyState` / `ErrorState`,
   which already open with `components/StateArt.tsx`. A
   paged list uses `components/LoadMoreButton.tsx` so the page end does not claim the page is over. Keep
   on-screen labels descriptive; no per-person scores, ranks or comparisons between people.
6. **Tests**: service unit test with fakes (`apps/api/test/fixtures/fake-query-repositories.ts`), a DB block in
   `apps/api/test/db/analytics-queries.integration.test.ts`, a view test with MSW. The route contract test
   (`apps/api/test/routes-contract.test.ts`) and `apps/web/src/lib/api.test.ts` fail until steps 4–5 exist.

## Add a field to the ingest contract

1. `packages/shared/src/ingest/schemas.ts` (optional field only — contract v1 is additive), limits in
   `packages/shared/src/constants/`, update `examples.ts` if useful.
2. A NEW migration adding the column + CHECK mirroring the zod limit (never edit an applied file).
3. Enricher (`apps/api/src/enrichment/`) if it needs a transformation — a FREE-TEXT field must go
   through `PiiScrubber` (and get a `PII_FIELD_VALUES` entry + CHECK row; ADR 0010) — then the ONLY wire → row mapper
   (`apps/api/src/domain/to-api-request-insert.ts` / `to-web-event-insert.ts`), then the `unnest` insert in
   `apps/api/src/repositories/api-request-ingest.repository.ts` / `web-event-ingest.repository.ts`.
4. Docs: the guide chapter (`docs/integration/02-server-contract.md` / `03-browser-contract.md`),
   `docs/CHANGELOG.md`, `npm run openapi:emit` (commit `docs/openapi.json`), the snippets if they send it.
5. Tests: `apps/api/test/db/schema-parity.integration.test.ts` (zod ↔ CHECK), mapper tests, snippet contract tests.

## Add a migration

1. `apps/api/migrations/NNNN_snake_case.sql`, next free number, a leading `-- intent` comment, schema-qualified
   names (`traffic.x`), indexes `idx_<table>_<cols>`. Additive only (rollback = older code on newer schema).
2. New table for the api role: nothing to do in owner mode. In separate mode **add it to the explicit
   DML list in `apps/api/src/db/migration-runner/grants.ts`** in the same change — the default
   privileges do NOT cover a fresh database (there the migrations create every table before
   `grants.ts` first runs `ALTER DEFAULT PRIVILEGES`; they only cover tables created on a later run).
   `apps/api/test/db/privileges.integration.test.ts` writes to each table as `nexus_app`. A new hourly
   aggregate table also goes into `AGGREGATE_TABLES` of
   `apps/api/src/repositories/aggregate-retention.repository.ts` so the retention job prunes it.
3. Update [07-data-model.md](07-data-model.md) and `apps/api/migrations/README.md`.
4. `RUN_DB_TESTS=1 npm run test:db` (the runner, parity and privileges suites apply it on a fresh database).

## Register an app and issue keys

Dashboard → **Apps** (admins in `DASHBOARD_ADMIN_EMAILS`): *Register app* (slug, base path, allowed origins) →
*Create key* (secret for servers, publishable for browsers; shown once) → send the team the guide link
`https://nexus.libas.in/traffic/api/docs/` and the key. Rotation: new key → team deploys → *Expire* the old one
with a grace period; leak: *Revoke* (immediate). API: `ROUTES.apps.*`, chain in
[03-code-navigation.md](03-code-navigation.md) §4.

## Add a socket event

1. `packages/shared/src/events.ts`: the name in `SOCKET_EVENTS`, its payload type in the typed event maps.
2. Server: emit it from `apps/api/src/live/` (per-role rooms via `LiveBroadcaster`; viewer payloads carry no IP).
3. Web: listen in `apps/web/src/features/live/` (`useLiveFeed.ts` pattern). Never type the event name by hand.
4. Tests: a unit test of the emitter and, for wiring, `apps/api/test/e2e/live-socket.test.ts`.

## Add an env var

1. `apps/api/src/config/env.schema.ts` (zod, with a default when sensible) — or the web schema
   `apps/web/src/env.schema.ts`, or a compose-only key in `COMPOSE_ONLY_KEYS`.
2. Describe it in `SECTIONS` of `scripts/generate-env-example.ts`, run `npm run env:example`, commit `.env.example`.
3. If compose must pass it to a container that has no `env_file`, add it under that service's `environment:`
   in `docker-compose.yml`. Secrets that must be hex: add them to `scripts/preflight.sh`.
4. `apps/api/test/env-example.test.ts` enforces steps 1–2.

## Add a background job

1. A class in `apps/api/src/jobs/<name>.job.ts` with `run(): Promise<void>` and an exported interval constant;
   cross-replica work takes an advisory lock (`withAdvisoryXactLock`, key in `ADVISORY_LOCKS` of
   `apps/api/src/db/schema.ts`) and runs on the locked client.
2. Build it in `apps/api/src/container.ts` (`jobs`), and add ONE `every(...)` line to `apps/api/src/jobs/scheduler.ts`.
3. Unit test with `apps/api/test/fixtures/fake-lock-pool.ts`; document it in [03-code-navigation.md](03-code-navigation.md) §5d.
