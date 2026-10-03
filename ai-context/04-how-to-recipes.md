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
   Row type in `apps/api/src/domain/rows.ts`, row → DTO in `apps/api/src/domain/mappers.ts` (IP admin-only).
3. **Service**: method named like the leaf in `apps/api/src/services/<group>.service.ts`
   (`resolveTimeWindow` → `AppSlugResolver` → repository), `@see` the repository method.
4. **Controller + route**: arrow property named like the leaf in `apps/api/src/http/controllers/<group>.controller.ts`;
   register it in `apps/api/src/http/routes/index.ts` with `...dashboard` and `validateQuery(schema)`. New
   classes are built in `apps/api/src/container.ts`.
5. **Web**: `api.<group>.<leaf>` in `apps/web/src/lib/api.ts`, a key in `apps/web/src/lib/query/keys.ts`, a hook
   `apps/web/src/features/<group>/use<Thing>.ts` (one query), the view `<X>View.tsx`. A new page also needs
   `apps/web/src/app/(dashboard)/<page>/page.tsx`, a builder in `apps/web/src/lib/pages.ts` and a nav entry in
   `apps/web/src/lib/nav.ts`.
6. **Tests**: service unit test with fakes (`apps/api/test/fixtures/fake-query-repositories.ts`), a DB block in
   `apps/api/test/db/analytics-queries.integration.test.ts`, a view test with MSW. The route contract test
   (`apps/api/test/routes-contract.test.ts`) and `apps/web/src/lib/api.test.ts` fail until steps 4–5 exist.

## Add a field to the ingest contract

1. `packages/shared/src/ingest/schemas.ts` (optional field only — contract v1 is additive), limits in
   `packages/shared/src/constants/`, update `examples.ts` if useful.
2. A NEW migration adding the column + CHECK mirroring the zod limit (never edit an applied file).
3. Enricher (`apps/api/src/enrichment/`) if it needs a transformation, then the ONLY wire → row mapper
   (`apps/api/src/domain/to-api-request-insert.ts` / `to-web-event-insert.ts`), then the `unnest` insert in
   `apps/api/src/repositories/api-request-ingest.repository.ts` / `web-event-ingest.repository.ts`.
4. Docs: the guide chapter (`docs/integration/02-server-contract.md` / `03-browser-contract.md`),
   `docs/CHANGELOG.md`, `npm run openapi:emit` (commit `docs/openapi.json`), the snippets if they send it.
5. Tests: `apps/api/test/db/schema-parity.integration.test.ts` (zod ↔ CHECK), mapper tests, snippet contract tests.

## Add a migration

1. `apps/api/migrations/NNNN_snake_case.sql`, next free number, a leading `-- intent` comment, schema-qualified
   names (`traffic.x`), indexes `idx_<table>_<cols>`. Additive only (rollback = older code on newer schema).
2. New table for the api role: nothing to do in owner mode; in separate mode the default privileges in
   `apps/api/src/db/migration-runner/grants.ts` cover it (add explicit grants there if it needs less than DML).
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
