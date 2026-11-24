# Migrations — `apps/api/migrations/`

Plain SQL, applied in version order by the `migrate` service
(`node dist/db/migrate.js`, locally `npm run migrate -w @nexus/api`). The runner lives in
[`../src/db/migration-runner/`](../src/db/migration-runner/runner.ts) and the CLI in
[`../src/db/migrate.ts`](../src/db/migrate.ts). Plain-English column descriptions:
[`ai-context/07-data-model.md`](../../../ai-context/07-data-model.md).

## Rules

1. File name `NNNN_snake_case.sql` (regex `^\d{4}_[a-z0-9_]+\.sql$`); versions are unique and contiguous.
2. The first line is a `-- intent:` comment saying why the migration exists.
3. **Never edit an applied file.** The ledger stores a sha256 of each file (CRLF/BOM normalised);
   an edit is reported as **drift** and `migrate` exits non-zero without applying anything.
   Fix forward with a new file.
4. Every object is fully qualified in schema `traffic` (`traffic.apps`, never `apps`).
5. No `BEGIN`/`COMMIT`: the runner wraps each file in one transaction (plus an advisory lock), so a
   failing file leaves no trace.
6. Enum `CHECK`s mirror the `*_VALUES` arrays of `packages/shared/src/constants/`; limits mirror
   `INGEST_LIMITS`. `test/db/schema-parity.integration.test.ts` fails when they drift.
7. Index names are `idx_<table>_<cols>`; constraint names are `<table>_<column>_check`.
8. No seed data. Roles and the schema are created by the **bootstrap**, not by a migration, and the
   runtime role's privileges live in [`../src/db/migration-runner/grants.ts`](../src/db/migration-runner/grants.ts)
   — a migration must NEVER mention `nexus_app` (it does not exist in `DB_APP_ROLE_MODE=owner`).
   **A new table MUST be added to the explicit DML list in `grants.ts`** in the same change: the
   default privileges do NOT cover a fresh database, because there the migrations create every table
   BEFORE `grants.ts` first runs `ALTER DEFAULT PRIVILEGES` (they only cover tables created on a
   later run). `test/db/privileges.integration.test.ts` writes to each table as nexus_app.
9. Additive changes only between deploys, so `git checkout <old> && docker compose up` stays safe
   (the runner treats "applied but unknown to this code" as a warning, exit 0).

## Role modes (`DB_APP_ROLE_MODE`, [ADR 0002](../../../ai-context/decisions/0002-external-database.md))

| Mode | Where | Runtime login of the api | What migrate does with roles |
|---|---|---|---|
| `owner` | production: the external server 10.150.0.5, database `nexus_traffic` (its login has no `CREATEROLE`) | the SAME login as `MIGRATION_DATABASE_URL` (`DATABASE_URL` is identical) | nothing — no role is created, altered or granted to |
| `separate` (default) | `--profile localdb` (local Docker Postgres), CI, the DB test suites | `nexus_app` (DML only) | creates `nexus_app`, sets its password from `NEXUS_APP_DB_PASSWORD` (≥ 16 chars), re-applies its grants |

## Every run of `migrate`

1. Connect as the owner (`MIGRATION_DATABASE_URL`), retrying 10 × 2 s.
2. **Bootstrap** (idempotent): `CREATE SCHEMA IF NOT EXISTS traffic`; in `separate` mode only,
   create role `nexus_app` if missing and `ALTER ROLE nexus_app PASSWORD` from
   `NEXUS_APP_DB_PASSWORD`; create the ledger `traffic.schema_migrations`.
3. Compare files with the ledger: pending / drifted / unknown-applied.
4. Apply pending files, one transaction each.
5. `separate` mode only: re-apply the `nexus_app` grants
   ([`grants.ts`](../src/db/migration-runner/grants.ts), one transaction under the migrate advisory
   lock; idempotent, so a revoked grant is repaired and new tables are covered).
6. `SELECT traffic.ensure_partitions(1, 2)` (last month … two months ahead).

Flags: `--status` (report only), `--dry` (show what would be applied). Exit codes: `0` ok,
`1` failed apply or error, `2` checksum drift.

## Table catalogue

| Table | Created in | Partitioned | Written by (role) | Purpose |
|---|---|---|---|---|
| `traffic.schema_migrations` | bootstrap | no | migrate (owner); read by the api | ledger: version, name, checksum, applied_at, execution_ms |
| `traffic.apps` | [0002](0002_apps_and_api_keys.sql) | no | nexus_app (admin API) | registered apps; `slug` is the public id |
| `traffic.api_keys` | [0002](0002_apps_and_api_keys.sql) | no | nexus_app (admin API, key auth) | secret/publishable keys, stored as HMAC hashes |
| `traffic.admin_audit_log` | [0003](0003_admin_audit_log.sql) | no | nexus_app, **append-only** | who changed which app/key, when |
| `traffic.api_requests` | [0004](0004_api_requests.sql) | monthly on `occurred_at` | nexus_app (server ingest) | one row per backend API call |
| `traffic.web_events` | [0005](0005_web_events.sql) | monthly on `occurred_at` | nexus_app (browser ingest) | page views, visible time, tool use, custom events |
| `traffic.ingest_counters` | [0006](0006_ingest_counters.sql) | no | nexus_app (ingest) | hourly accepted/duplicate/rejected/rate-limited counts |
| `traffic.ingest_rejections` | [0010](0010_ingest_rejections.sql) | no | nexus_app (ingest) | hourly refused events per source, SDK, code and normalised schema path (codes only, never messages) |
| `traffic.pii_detections` | [0011](0011_pii_detections.sql) | no | nexus_app (ingest) | hourly PII redactions per source, field and kind (counts only, never values) |
| `traffic.sso_cookie_outcomes` | [0012](0012_sso_cookie_outcomes.sql) | no | nexus_app (browser ingest) | hourly SSO cookie verification outcomes per beacon origin |
| `traffic.person_access_log` | [0013](0013_person_access_log.sql), surface CHECK widened by [0014](0014_person_access_surfaces_day_pattern_visit_steps.sql) | no | nexus_app, **append-only** (person-level reads) | which admin opened which part of whose person page, when; person = `user_key` + masked email |

Column additions: [0007](0007_event_environment_and_client_context.sql) adds `environment`
(both event tables, default `'prod'`) and `client_tz`, `client_lang`, `release` (`web_events`);
[0008](0008_api_requests_page_view_index.sql) adds `idx_api_requests_page_view_id`;
[0009](0009_app_sdk_config.sql) adds `sdk_config_version`, `sdk_disabled_modules`,
`sdk_config_updated_at` to `apps` and swaps `admin_audit_log_action_check` (same name) to allow
`APP_SDK_CONFIG_UPDATE`. [0013](0013_person_access_log.sql) also adds the trigger function
`traffic.reject_person_access_log_change()` and two triggers that refuse UPDATE / DELETE (per row) and
TRUNCATE (per statement) on `person_access_log` for every role, the owner included;
[0014](0014_person_access_surfaces_day_pattern_visit_steps.sql) swaps `person_access_log_surface_check`
(same name, widening only, added `NOT VALID` then validated) to allow `person_day`, `person_pattern` and
`person_visit_steps` (ADR 0017). The three aggregate tables of 0010–0012 are pruned after
`AGGREGATE_RETENTION_DAYS` (90) by the retention job.

## Functions ([0001](0001_helpers_and_partitions.sql))

| Function | Security | Who may call | What it does |
|---|---|---|---|
| `traffic.set_updated_at()` | INVOKER | trigger on `apps` | stamps `updated_at` |
| `traffic.ensure_monthly_partition(parent, month)` | DEFINER | owner, nexus_app | creates `<parent>_yYYYYmMM` (UTC bounds) if missing; race-safe |
| `traffic.ensure_partitions(back, ahead)` | DEFINER | owner, nexus_app | ensures both tables' partitions for `now − back … now + ahead` months |
| `traffic.drop_expired_partitions(parent, keep)` | DEFINER | owner, nexus_app | `DETACH` + `DROP` partitions older than the current month − `keep` (lock_timeout 2 s) |

The partition functions accept only `api_requests` / `web_events` (anything else raises `22023`),
pin `search_path = traffic, pg_catalog, pg_temp`, quote identifiers with `format('%I')`, and are
revoked from `PUBLIC`; `EXECUTE` for nexus_app is granted by
[`grants.ts`](../src/db/migration-runner/grants.ts) (separate mode).

## Privileges ([`grants.ts`](../src/db/migration-runner/grants.ts), `DB_APP_ROLE_MODE=separate` only)

`nexus_app`: `USAGE` on schema `traffic`; `SELECT, INSERT, UPDATE, DELETE` on `apps`, `api_keys`,
`api_requests`, `web_events`, `ingest_counters`, `ingest_rejections`, `pii_detections`,
`sso_cookie_outcomes`; `SELECT, INSERT` on `admin_audit_log` and `person_access_log` (plus an explicit
`REVOKE UPDATE, DELETE, TRUNCATE` on the latter, so the default privileges of an already-migrated
database cannot widen it); `SELECT` on
`schema_migrations`; sequences `USAGE, SELECT`; `EXECUTE` on the three partition functions; default
privileges for tables/sequences the owner creates later (monthly partitions included) — these do
NOT cover tables created by the migrations of a fresh database, hence the explicit table list (rule 8). **No DDL,
no TRUNCATE** — verified by `test/db/privileges.integration.test.ts`. In `owner` mode there is no
`nexus_app`; the api runs as the owner (see ADR 0002, "Consequences").

**History:** until 2026-10-01 these grants were migration `0007_grants.sql`. It was moved into code
before the first production deploy, because a migration cannot GRANT to a role that `owner` mode never
creates. A database migrated by an S1 rehearsal still lists `0007_grants` in its ledger; the runner and
the api report it as *unknown-applied* (a warning only). The comments of `0001`/`0003` still mention
`0007_grants.sql`: they are left untouched on purpose, because editing an applied file is checksum
drift (rule 3).

## Adding a migration

1. Change `packages/shared` first if the contract changes (enum, limit).
2. Add `NNNN_what_it_does.sql` with a `-- intent:` line; qualify everything with `traffic.`.
3. Update `src/domain/rows.ts` / `inserts.ts`, the repositories, this catalogue and
   `ai-context/07-data-model.md`. A new table also goes into the DML list of `grants.ts` (rule 8).
4. Run `RUN_DB_TESTS=1 npm run test:db -w @nexus/api`.
