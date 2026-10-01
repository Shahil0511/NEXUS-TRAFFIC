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
8. No seed data. Roles and the schema are created by the **bootstrap**, not by a migration.
9. Additive changes only between deploys, so `git checkout <old> && docker compose up` stays safe
   (the runner treats "applied but unknown to this code" as a warning, exit 0).

## Every run of `migrate`

1. Connect as the owner (`MIGRATION_DATABASE_URL`), retrying 10 × 2 s.
2. **Bootstrap** (idempotent): `CREATE SCHEMA IF NOT EXISTS traffic`; create role `nexus_app` if
   missing; `ALTER ROLE nexus_app PASSWORD` from `NEXUS_APP_DB_PASSWORD`; create the ledger
   `traffic.schema_migrations`.
3. Compare files with the ledger: pending / drifted / unknown-applied.
4. Apply pending files, one transaction each.
5. `SELECT traffic.ensure_partitions(1, 2)` (last month … two months ahead).

Flags: `--status` (report only), `--dry` (show what would be applied). Exit codes: `0` ok,
`1` failed apply or error, `2` checksum drift.

## Table catalogue

| Table | Created in | Partitioned | Written by (role) | Purpose |
|---|---|---|---|---|
| `traffic.schema_migrations` | bootstrap | no | migrate (owner); read by nexus_app | ledger: version, name, checksum, applied_at, execution_ms |
| `traffic.apps` | [0002](0002_apps_and_api_keys.sql) | no | nexus_app (admin API) | registered apps; `slug` is the public id |
| `traffic.api_keys` | [0002](0002_apps_and_api_keys.sql) | no | nexus_app (admin API, key auth) | secret/publishable keys, stored as HMAC hashes |
| `traffic.admin_audit_log` | [0003](0003_admin_audit_log.sql) | no | nexus_app, **append-only** | who changed which app/key, when |
| `traffic.api_requests` | [0004](0004_api_requests.sql) | monthly on `occurred_at` | nexus_app (server ingest) | one row per backend API call |
| `traffic.web_events` | [0005](0005_web_events.sql) | monthly on `occurred_at` | nexus_app (browser ingest) | page views, visible time, tool use, custom events |
| `traffic.ingest_counters` | [0006](0006_ingest_counters.sql) | no | nexus_app (ingest) | hourly accepted/duplicate/rejected/rate-limited counts |

## Functions ([0001](0001_helpers_and_partitions.sql))

| Function | Security | Who may call | What it does |
|---|---|---|---|
| `traffic.set_updated_at()` | INVOKER | trigger on `apps` | stamps `updated_at` |
| `traffic.ensure_monthly_partition(parent, month)` | DEFINER | owner, nexus_app | creates `<parent>_yYYYYmMM` (UTC bounds) if missing; race-safe |
| `traffic.ensure_partitions(back, ahead)` | DEFINER | owner, nexus_app | ensures both tables' partitions for `now − back … now + ahead` months |
| `traffic.drop_expired_partitions(parent, keep)` | DEFINER | owner, nexus_app | `DETACH` + `DROP` partitions older than the current month − `keep` (lock_timeout 2 s) |

The partition functions accept only `api_requests` / `web_events` (anything else raises `22023`),
pin `search_path = traffic, pg_catalog, pg_temp`, quote identifiers with `format('%I')`, and are
revoked from `PUBLIC`; `EXECUTE` for nexus_app is granted in [0007](0007_grants.sql).

## Privileges ([0007](0007_grants.sql))

`nexus_app`: `USAGE` on schema `traffic`; `SELECT, INSERT, UPDATE, DELETE` on `apps`, `api_keys`,
`api_requests`, `web_events`, `ingest_counters`; `SELECT, INSERT` on `admin_audit_log`; `SELECT` on
`schema_migrations`; sequences `USAGE, SELECT`; `EXECUTE` on the three partition functions; default
privileges for tables/sequences the owner creates later (monthly partitions included). **No DDL,
no TRUNCATE** — verified by `test/db/privileges.integration.test.ts`.

## Adding a migration

1. Change `packages/shared` first if the contract changes (enum, limit).
2. Add `NNNN_what_it_does.sql` with a `-- intent:` line; qualify everything with `traffic.`.
3. Update `src/domain/rows.ts` / `inserts.ts`, the repositories, this catalogue and
   `ai-context/07-data-model.md`.
4. Run `RUN_DB_TESTS=1 npm run test:db -w @nexus/api`.
