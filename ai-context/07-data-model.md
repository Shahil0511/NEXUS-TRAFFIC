# 07 — Data model

Everything lives in one schema, `traffic`, of our own database `nexus_traffic` — in production on the
company PostgreSQL 18 server 10.150.0.5, locally in the `postgres:18-alpine` container of
`--profile localdb` ([ADR 0002](decisions/0002-external-database.md); the suites also pass on 17). The SQL is in
[`apps/api/migrations/`](../apps/api/migrations/README.md) (that README has the table catalogue,
the function list and the privilege list). This page explains every table and column in plain
words, how partitions and retention work, the identity levels, and how personal data is protected.

Row types in code: [`apps/api/src/domain/rows.ts`](../apps/api/src/domain/rows.ts) (what we SELECT,
snake_case) and [`apps/api/src/domain/inserts.ts`](../apps/api/src/domain/inserts.ts) (what we
INSERT, camelCase — the repositories map one to the other).

## Database roles (`DB_APP_ROLE_MODE`)

| Role | Used by | Can do |
|---|---|---|
| owner (the `MIGRATION_DATABASE_URL` login: `POSTGRES_USER` locally, the shared login on 10.150.0.5) | the `migrate` service; **also the api in `owner` mode** | everything in our database: runs the bootstrap and the migrations |
| `nexus_app` (`separate` mode only) | the api container | read/write rows only. No `CREATE`, `ALTER`, `DROP` or `TRUNCATE`. The audit log and the person access log are append-only. Partitions are created/dropped only through three whitelisted functions. Grants: `apps/api/src/db/migration-runner/grants.ts`, re-applied by every migrate run. |

Why `separate` exists: if the api ever had an SQL-injection bug, it still could not drop or alter
tables. Why `owner` exists: the shared server's login has no `CREATEROLE`, so production cannot have
a second role; an injection bug could then run DDL on *our* database only — the login has no rights on
the other apps' databases (ADR 0002). Raw SQL stays parameterised and partition DDL still goes
through the whitelisted functions.

## Tables at a glance

| Table | One row per… | Size | Partitioned |
|---|---|---|---|
| `apps` | app that sends us data (e.g. `ebo-sales`) | tiny | no |
| `api_keys` | API key issued to an app | tiny | no |
| `admin_audit_log` | admin action on an app or key | tiny | no |
| `api_requests` | backend API call reported by an app's server | large | monthly |
| `web_events` | browser event reported by an app's frontend | large | monthly |
| `ingest_counters` | app × source × hour | small | no |
| `ingest_rejections` | app × source × SDK × code × schema path × hour | small | no |
| `pii_detections` | app × source × field × PII kind × hour | small | no |
| `sso_cookie_outcomes` | app × cookie outcome × beacon origin × hour | small | no |
| `person_access_log` | admin opening one part of one person's page, or a list narrowed to one person (coalesced) | small | no |
| `schema_migrations` | applied migration file | tiny | no |

There is **no sessions table**: a session is all `web_events` rows with the same
`(app_id, session_id)`.

## `apps` — registered apps

| Column | Meaning |
|---|---|
| `id` | internal uuid. Never shown in URLs. |
| `slug` | the public id, e.g. `ebo-sales` (lower-case letters, digits, dashes; 2–63 chars). Unique. Staging and dev traffic is told apart by the events' `environment` column ([ADR 0008](decisions/0008-environment-dimension.md)); a separate `<slug>-dev` app is still allowed. |
| `display_name` | name shown on the dashboard (1–100 chars). |
| `base_path` | URL prefix of the app on `nexus.libas.in`, e.g. `/ebo-sales`. Browser events must have paths under it. Optional. |
| `allowed_origins` | browser origins allowed to send events (e.g. `https://nexus.libas.in`), max 20. |
| `is_active` | `false` = the app is disabled; all its keys stop working. |
| `browser_ingest_enabled` | `false` = only server events are accepted. This is the **kill switch** of the browser SDK: browser batches get `403 BROWSER_INGEST_DISABLED` (every SDK version), and SDK ≥ 1.1.0 stops capturing in the page ([ADR 0009](decisions/0009-sdk-remote-config-and-kill-switch.md)). |
| `sdk_config_version` | remote SDK config version, ≥ 1, bumped on every change (optimistic concurrency: the admin sends `expectedVersion`). Migration 0009. |
| `sdk_disabled_modules` | capture modules the SDK must switch OFF (`SDK_CAPTURE_MODULE_VALUES`; CHECK `apps_sdk_disabled_modules_check`). Remote config can only disable. Default `{}`. |
| `sdk_config_updated_at` | when the remote config was last changed (null = never). |
| `created_by` | email of the admin who registered it. |
| `created_at`, `updated_at` | timestamps; `updated_at` is set by a trigger on every update. |

## `api_keys` — API keys

An app can have several active keys (so keys can be rotated with a grace period).

| Column | Meaning |
|---|---|
| `id` | uuid. |
| `app_id` | the app the key belongs to (an app with keys cannot be deleted). |
| `kind` | `secret` (`nx_sk_…`, backends only) or `publishable` (`nx_pk_…`, may ship in a browser bundle; it can only write events). |
| `key_prefix` | first 14 characters of the key, e.g. `nx_sk_AbCd1234`. Unique; used to look the key up and to show it on the dashboard. Must match the kind. |
| `key_hash` | `HMAC-SHA256(API_KEY_PEPPER, full key)`, exactly 32 bytes. The full secret is **never stored** — it is shown once, at creation. |
| `public_key` | the full publishable key (it is public anyway). Always empty for secret keys. |
| `label` | admin's note, e.g. "production backend". |
| `created_by`, `created_at` | who/when. |
| `expires_at` | set when rotating: the old key keeps working until this time. |
| `last_used_at`, `last_sdk` | last successful use (updated at most once a minute) and the SDK name/version that used it. |
| `exposed_at` | set the first time a **secret** key was sent to the browser endpoint (a leak — rotate it). |
| `revoked_at`, `revoked_by` | set together when an admin revokes the key; the first revocation is kept. |

## `admin_audit_log` — who changed what

Append-only: the api can insert and read, never update or delete.

| Column | Meaning |
|---|---|
| `id` | increasing number. |
| `created_at` | when. |
| `actor_email` | the admin. |
| `action` | `APP_CREATE`, `APP_UPDATE`, `APP_DISABLE`, `KEY_CREATE`, `KEY_EXPIRE`, `KEY_REVOKE`, `APP_SDK_CONFIG_UPDATE` (added in 0009 by swapping the CHECK under the same name). |
| `target_type`, `target_id` | `app` or `api_key`, and its id. |
| `details` | small JSON object (≤ 4 KB) with what changed. Never contains a secret. |

## `api_requests` — backend API calls

Sent by an app's server middleware to `POST /v1/ingest/server`. One row per request.

| Column | Meaning |
|---|---|
| `occurred_at` | when the request **started**, exactly as the app sent it (never shifted). |
| `event_id` | uuid made by the app when it captured the event, reused on retries. Together with `occurred_at` it is the primary key, so a retried batch never creates duplicates. |
| `received_at` | when our database stored it (always the DB clock, never app-supplied). |
| `clock_skew_ms` | how far the sender's clock was off (`received − sentAt`); diagnostics only. |
| `app_id` | the app. |
| `endpoint_id` | stable uuid of (app, method, route template), computed at ingest so dashboard URLs carry an opaque id. |
| `kind` | `http` or `stream` (SSE, downloads, exports — excluded from latency percentiles). |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`. |
| `route_template` | the route pattern, e.g. `/ebo-sales/api/stores/:id` (≤ 256 chars, starts with `/`). |
| `path` | the concrete path **without query string**, e.g. `/ebo-sales/api/stores/42` (≤ 512 chars, starts with `/`). |
| `status_code` | HTTP status 100–599 (the wire field is `status`). |
| `duration_ms` | response time, 0 – 3 600 000. |
| `request_bytes`, `response_bytes` | body sizes when known. |
| `error_code` | the app's error **code** (e.g. `VALIDATION_ERROR`, `^[A-Z0-9_]{1,64}$`). Error messages are never accepted. Grouped on the Errors page ("Error codes" panel, `?errorCode=` filter) — a reason for apps to send stable codes. |
| `release` | the app's version/commit (≤ 64). Dropped when it contains personal data (ADR 0010). |
| `request_id` | the app's request id for cross-referencing its own logs (≤ 128). Dropped when it contains personal data. |
| `environment` | `prod`, `staging` or `dev` (`ENVIRONMENT_VALUES`, CHECK `api_requests_environment_check`), from the envelope claim; default `'prod'` (also every row written before 0007). Every dashboard read filters on it except Integration Health ([ADR 0008](decisions/0008-environment-dimension.md)). |
| `session_id`, `page_view_id` | browser session / page view that triggered the call, copied from `X-Nexus-Session` / `X-Nexus-Page-View`, which the React tracker adds to same-origin calls by default ([ADR 0011](decisions/0011-header-propagation-and-early-entry.md)). `page_view_id` has the partial index `idx_api_requests_page_view_id` (0008). |
| `user_email`, `user_key`, `claimed_email`, `identity_source` | who made the request — see **Identity levels** below. |
| `ip`, `ip_hash`, `ip_class` | client IP — see **Personal data** below. `ip_class` is `public`, `private`, `loopback` or `unknown`. |
| `geo_country`, `geo_region`, `geo_city`, `geo_lat`, `geo_lon` | approximate location from the IP (GeoLite2 data bundled with geoip-lite). Country is a 2-letter code; lat/lon are rounded to 1 decimal (city level). |
| `ua_browser`, `ua_os`, `ua_device` | parsed from the User-Agent (≤ 128 / 128 / 32 chars); the raw User-Agent is not stored. |
| `sdk` | name/version of the sending SDK (≤ 100). |

## `web_events` — browser events

Sent by an app's frontend tracker to `POST /v1/ingest/browser`. Same time, idempotency, identity,
IP, geo and client columns as `api_requests`, plus:

| Column | Meaning |
|---|---|
| `session_id` | per-tab session (rotated after 30 min idle). A journey = all events of one session ordered by `seq`. |
| `anonymous_id` | per-device id (localStorage), optional. |
| `seq` | increasing number within the session; orders events that share a timestamp. |
| `event_type` | `page_view`, `page_time`, `tool_use` or `custom`. |
| `path`, `path_template` | the page path (no query string) and its pattern — the SDK's `routeTemplate` when it passes the plausibility guard, else the server's guess. `toPageId` derives from it ([ADR 0013](decisions/0013-integration-diagnostics-and-kpis.md), page-id cut-over). Both pass the PII scrubber; the stored `path` also gets the segment scrub. |
| `referrer_path` | previous in-app path; `referrer_host` the external site's host only (never a full URL). |
| `nav` | `load` (full page load) or `route` (client-side navigation). |
| `page_view_id` | for `page_time`: the `event_id` of the page view it belongs to. **Required** for `page_time`. |
| `visible_ms` | for `page_time`: milliseconds the page was visible **since the previous `page_time` of the same view** (a delta; sum them per page view). 0 – 86 400 000. Required for `page_time`. Summed per IST day for one person = the person page's "Active time (tab visible)" (`listUserDailyActivity`). |
| `is_final`, `time_reason` | for `page_time`: whether this was the last delta of the view, and why it was sent (`hidden`, `route`, `pagehide`, `idle`). Required for `page_time`. |
| `tool` | for `tool_use`: the UI tool, e.g. `audits.export-csv` (`^[a-z0-9][a-z0-9_.:-]{0,63}$`). Required for `tool_use`. |
| `action` | optional verb: `click`, `open`, `submit`, `export`, `toggle`, `search`, `other`. |
| `label` | a **static** UI label (≤ 120), never user-typed text. |
| `value` | an optional number. |
| `name` | for `custom`: the event name (same pattern as `tool`). Required for `custom`. |
| `props` | optional flat JSON object of scalar values (≤ 2 KB). String values are PII-scrubbed; a key with PII drops the prop. |
| `environment` | `prod`, `staging` or `dev` (CHECK `web_events_environment_check`); `dev` whenever the page origin is loopback. Default `'prod'`. |
| `client_tz`, `client_lang` | the browser's time zone (`Asia/Kolkata`, ≤ 64) and language (`en-IN`, ≤ 16) from the envelope `client`, when they match `CLIENT_TZ_PATTERN` / `CLIENT_LANG_PATTERN`; else null. Migration 0007. |
| `release` | the frontend build (envelope `release`, ≤ 64); null when not sent. |

## `ingest_counters` — ingest health

One row per app, source (`server` / `browser`) and hour. `accepted`, `duplicates`, `rejected` and
`rate_limited` are added to on every ingest call. `bucket_hour` is the start of the hour **in India
time** (10:45 IST is counted in the 10:00 IST bucket), matching the dashboard's hourly charts.
Read by the Integration Health page.

## `ingest_rejections` — why events were refused (0010)

One row per app, source, `sdk`, `code`, `schema_path` and hour; `rejected` is added to.
`code` ∈ `INGEST_REJECTION_CODE_VALUES`: the per-event codes plus server `INVALID_ENVELOPE` and
browser `ORIGIN_NOT_ALLOWED` (envelope-level, recorded only once the app is known). `sdk` is the
strictly normalised `name@version` or `''` (always `''` for `ORIGIN_NOT_ALLOWED`); `schema_path` is
the normalised zod path (`props.*`, `occurredAt`; ≤ 128, `^[A-Za-z0-9_.*]*$`) or `''`. **Never** a
message or a value. ≤ 20 distinct keys per batch.

## `pii_detections` — what the PII scrubber redacted (0011)

One row per app, source, `field` (`PII_FIELD_VALUES`), `kind` (`PII_KIND_VALUES`: email, phone, pan,
gstin, aadhaar) and hour; `detections` is added to (one per event, field and kind). Counts only — the
matched value is never stored ([ADR 0010](decisions/0010-ingest-pii-detector.md)).

## `sso_cookie_outcomes` — why browser events are anonymous (0012)

One row per app, `outcome` (`SSO_COOKIE_OUTCOME_VALUES`: `ok`, `no-cookie`, `expired`,
`bad-signature`, …, `no-email`), `beacon_origin` (`same_origin`, `cross_origin`, `none` — the
request Origin against `PUBLIC_ORIGIN`) and hour; `beacons` is added to, once per browser batch.
Retry-queue replays are not counted.

The three tables share the `bucket_hour` alignment of `ingest_counters`, an index on `bucket_hour`
(`idx_<table>_bucket_hour`, for the retention delete), explicit DML grants for `nexus_app` in
`apps/api/src/db/migration-runner/grants.ts`, and a `''`-means-none convention (a NULL cannot be in
the primary key; the API maps `''` to `null`).

## `person_access_log` — who opened whose person page (0013)

Append-only: `nexus_app` may insert and read only (`grants.ts`, which also REVOKEs UPDATE, DELETE and
TRUNCATE), and triggers (`traffic.reject_person_access_log_change`) refuse UPDATE, DELETE and
TRUNCATE for **every** role, the owner included. Written by `PersonAccessRecorder`
(`apps/api/src/services/person-access.recorder.ts`) after a successful person-level read
(`users.profile`, `users.timeline`, `users.devices`, `users.daily`, and `journeys.sessions` /
`errors.summary` / `errors.list` narrowed by `?userKey=`; all admin-only, ADR 0015); read by
`ROUTES.privacy.accessLog` (admin-only, the Privacy & access page).

| Column | Meaning |
|---|---|
| `id` | increasing number (identity). |
| `viewed_at` | when (default `now()`). |
| `viewer_email` | the admin who opened the page (1–254 chars). |
| `subject_user_key` | the person's `user_key` (32 bytes, same as on the event tables). |
| `subject_email_masked` | the person's email MASKED by the API (`s***@libas.in`); a CHECK refuses anything else. The full address is never stored here. |
| `surface` | which part: `PERSON_ACCESS_SURFACE_VALUES` (`person_profile`, `person_timeline`, `person_devices`, `person_daily`, and `person_visits` / `person_failures` for the Journeys / Errors lists narrowed by `?userKey=`, ADR 0015). |

Coalescing: the same viewer + person + surface is recorded at most once per
`PERSON_ACCESS_COALESCE_MS` (10 min), decided **in memory** per api process
(`apps/api/src/services/person-access.coalescer.ts`): no database round trip for repeats; a restart
or a second replica can only add a duplicate row, never lose one; a concurrent request with the same key
waits for the running attempt and records itself if that one wrote nothing. The dashboard never refetches
person-level queries because of live traffic, so a page left open adds no rows. No row when the person has no event
in the read's window (nothing about them was shown). A failed write does not fail the read: the api
logs a warning with the surface and the pg error code only. Indexes: `idx_person_access_log_viewed_at`
`(viewed_at DESC, id DESC)` for the newest-first list, `idx_person_access_log_subject_user_key_viewed_at`
for the per-person filter. Not pruned by any job.

## `schema_migrations` — the migration ledger

Created by the migrate bootstrap. One row per applied file: `version` (`0004`), `name`,
`checksum` (sha256 of the file), `applied_at`, `execution_ms`. The api refuses to start if a file
is pending or was edited after it was applied.

## Partitions and retention

- `api_requests` and `web_events` are split into **one table per UTC month**, named
  `<table>_yYYYYmMM` (e.g. `api_requests_y2026m10` holds 2026-10-01 00:00 UTC up to 2026-11-01).
- There is **no default partition**: an event for a month without a partition fails with
  "no partition of relation …"; the ingest service then creates it and retries once.
- Partitions are created by `traffic.ensure_partitions(1, 2)` — last month, this month and the
  next two — at every `migrate` run, at api boot and every 6 hours. Last month is included because
  events may arrive up to 7 days late (an event from the 27th sent on the 3rd still fits).
- **Retention**: every night at 02:30 IST the api calls `traffic.drop_expired_partitions(table,
  RAW_RETENTION_MONTHS)` (default 6). With 6 in October it keeps April–October and drops March and
  older: a whole month is detached and dropped at once instead of deleting millions of rows.
  It waits at most 2 s for locks; if busy it simply retries on the next night.
- The three partition functions run with the owner's rights (`SECURITY DEFINER`) but accept only
  these two table names, so `nexus_app` gets exactly this power and nothing more.
- **Aggregate retention**: in the same nightly run (inside the retention advisory lock, after the
  partition drop) `AggregateRetentionService.deleteExpired` deletes rows of `ingest_rejections`,
  `pii_detections` and `sso_cookie_outcomes` older than `AGGREGATE_RETENTION_DAYS` (90).
  `ingest_counters` is kept as before.

## Indexes worth knowing

- `idx_api_requests_page_view_id` (0008, partial `WHERE page_view_id IS NOT NULL`, on the parent so
  every monthly partition has it): serves a page's API calls (`listPageApiCalls`) and the page-view
  linking KPI.
- **No BRIN index** (decided in ADR 0013): monthly partitions plus the primary-key btree
  `(occurred_at, event_id)` and `(app_id, occurred_at DESC)` already serve every window scan.
- Coverage KPIs (identified, linkable, linked) are defined once, in
  `apps/api/src/repositories/coverage-predicates.ts`.

## Identity levels

Every event records **how much we trust** the user identity, strongest first:

| `identity_source` | Meaning | `user_email` / `user_key` | `claimed_email` |
|---|---|---|---|
| `sso_cookie` | our collector itself verified the company SSO cookie (browser beacon on the same site) | filled | — |
| `app_attested` | the app's backend sent the email, authenticated with its **secret** key | filled | — |
| `client_claimed` | the browser said "I am x@…" — anyone with the public key can forge this | **empty** | filled |
| `anonymous` | no identity | empty | — |

The database enforces it: `user_email` is filled **if and only if** the source is `sso_cookie` or
`app_attested`, `user_key` is filled exactly when `user_email` is, and emails are stored lower-case.
So forged identities can never inflate user counts or impersonate someone; claimed emails only show
with a "claimed" badge.

`user_key` = `HMAC-SHA256(USER_KEY_SECRET, user_email)` (32 bytes). Dashboard URLs use this opaque
key, never the email, so emails do not end up in gateway logs.

## Personal data (PII) and how it is protected

| Data | Stored as | Protection |
|---|---|---|
| user email | `user_email` (verified only), `claimed_email` | dashboard behind SSO; URLs use `user_key`; logs mask emails (`s***@libas.in`) |
| IP address | `ip` per `IP_STORAGE_MODE`: `full` (default, requested by the business), `truncated` (/24 for IPv4, /48 for IPv6) or `hashed` (`ip` empty, only `ip_hash` = HMAC with `IP_HASH_SECRET`) | geo is always resolved from the full IP **before** storage; IPs are visible to dashboard admins only |
| location | country/region/city, lat/lon rounded to 1 decimal | city-level only |
| user agent | parsed browser/OS/device class only | raw string not stored |
| API keys | HMAC hash (secret keys), clear text only for publishable keys | full secret shown once; never logged |
| URLs | path only | query strings, fragments, request/response bodies, headers, tokens and error messages are **never stored** |
| phone, PAN, GSTIN, Aadhaar, emails in free text | replaced by `:phone`, `:pan`, … (paths, labels, prop values), `redacted` (tool / name), or the field dropped | the ingest PII scrubber, two passes ([ADR 0010](decisions/0010-ingest-pii-detector.md)); only counts are kept (`pii_detections`) |
| rejected events | code + normalised field path only | zod messages and values are never stored (`ingest_rejections`) |
| person page opens | admin email + person `user_key` + masked person email + part | admin-only reads, append-only table (`person_access_log`) |

All raw events disappear with their monthly partition after `RAW_RETENTION_MONTHS`; the hourly
diagnostic aggregates after `AGGREGATE_RETENTION_DAYS`.
