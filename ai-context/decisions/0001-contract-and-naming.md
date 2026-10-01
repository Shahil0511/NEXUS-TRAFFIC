# ADR 0001 — Contract and naming (the canonical decisions)

- **Status:** accepted (2026-10-01)
- **Context:** four independent layer designs (DB, API, dashboard, integration/Docker) were drafted
  in parallel and disagreed on table names, routes, key formats, event types, identity values,
  ports and paths. Three adversarial reviews (navigability/SOLID, security/scale,
  completeness/deployability) and a final verification pass reconciled them.
- **Decision:** the table below is the single source of truth. Code that disagrees with it is a bug;
  change the table (via a new ADR) before changing the code.

## Decisions


| Topic | Decision |
|---|---|
| Language / runtime | TypeScript strict everywhere (AV `tsconfig.base.json` + `noUnusedLocals/Parameters`). Node 22. Express **5** (native async errors, so **no `asyncHandler`**). zod **4**. vitest. Next **16** App Router + React 19. |
| Public URLs | Dashboard: `https://nexus.libas.in/traffic/`. API: `…/traffic/api/*`. Socket.io: `…/traffic/socket.io/`. nginx **strips `/traffic`** for api and socket. The web app keeps `basePath: '/traffic'`, a hard-coded shared constant `PUBLIC_BASE_PATH`. |
| Containers / ports | api listens on 4000 (host `127.0.0.1:4005`). web listens on 3000 (host `127.0.0.1:3305`). postgres is not published. Express mounts `app.use('/api', buildRouter(c))`. The Socket.io server path is `/socket.io`; the client path is `NEXT_PUBLIC_SOCKET_PATH=/traffic/socket.io`. Local full-stack testing goes through the `edge` nginx service (profile `local`, `127.0.0.1:8080`), which reuses the same location blocks as the production snippet. |
| Tables | `apps`, `api_keys`, `admin_audit_log`, `api_requests` + `web_events` (both monthly-partitioned on `occurred_at`, **no default partition**), `ingest_counters`, `schema_migrations`. **No** `web_sessions` table in v1: sessions are derived with `GROUP BY (app_id, session_id)`. |
| App identity | `apps.id uuid` is internal. `apps.slug` (e.g. `ebo-sales`) is the public id in URLs, DTOs and filters. **No environment dimension**: staging uses its own slug (`ebo-sales-dev`). |
| API keys | Secret: `nx_sk_` + 40 base62. Publishable: `nx_pk_` + 32 base62. Lookup is by `key_prefix` (first 14 chars). Storage is `key_hash bytea` (CHECK `octet_length = 32`) = `HMAC-SHA256(API_KEY_PEPPER, key)`, compared with `timingSafeEqual`. Publishable keys are also stored in `public_key` (they ship in bundles anyway). Several active keys per app. **Rotation**: `apps.createKey`, then `apps.expireKey` on the old key (grace period). Also `apps.revokeKey`. A secret sent to the browser endpoint sets `exposed_at`. The full secret is shown **once**. |
| Ingest endpoints | `POST /v1/ingest/server` (secret key in the `X-Nexus-Key` header; supports `?dryRun=1`). `POST /v1/ingest/browser` (publishable key **in the body**, `text/plain`, plus the Origin allowlist and the base-path rule). `GET /v1/ingest/verify` (either key kind) → `{app, keyKind, contractVersion, serverTime}`. |
| Ingest semantics | **Synchronous**: validate → enrich → `INSERT … SELECT FROM unnest(...) ON CONFLICT DO NOTHING RETURNING event_id` → **202** `{accepted, duplicates, rejected[{index,code,message}], warnings[]}`. No in-memory write buffer, so nothing is lost on crash. Pool timeout → `503 INGEST_UNAVAILABLE` + `Retry-After`. |
| Idempotency / time | `eventId` (uuid, **required**, created at capture and reused on retry). PK `(occurred_at, event_id)`. `occurred_at` is the sender's value stored **verbatim** and is never shifted. Events outside `[received − 7d, received + 5min]` are **rejected** per event (`EVENT_TIME_OUT_OF_RANGE`). `clock_skew_ms = received_at − sentAt` is metadata. `received_at` is always DB `now()` and never app-supplied. |
| Browser events | `page_view` · `page_time` (`visibleMs` **delta**, summed per `pageViewId`) · `tool_use` (field `tool`) · `custom` (field `name`). Tool use is **auto-captured** from `[data-nexus-tool]` clicks, plus manual `trackTool()`. |
| Server events | `kind`: `http` \| `stream` (streams are excluded from latency percentiles). The wire field is `status` and the column is `status_code`, mapped only in `toApiRequestInsert()`. Optional `errorCode` (`^[A-Z0-9_]+$`) is accepted; **error messages, tags and titles are never accepted** in v1. Optional `release`. |
| Identity | `identity_source ∈ sso_cookie > app_attested > client_claimed > anonymous`:<br>• `sso_cookie`: the collector verified the cookie on a same-origin beacon.<br>• `app_attested`: the app backend sent `userEmail` with its secret key.<br>• `client_claimed`: a browser hint.<br>**Only** `sso_cookie`/`app_attested` fill `user_email` and `user_key`. `client_claimed` goes to `claimed_email` only and shows a "claimed" badge. |
| Opaque ids | `user_key bytea = HMAC-SHA256(USER_KEY_SECRET, user_email)` and `endpoint_id uuid = toEndpointId(slug, method, routeTemplate)` (uuid v5) are **computed at ingest and stored**, so URLs never carry emails. |
| Session ↔ API correlation | Optional `sessionId`/`pageViewId` on server events, filled from the `X-Nexus-Session` / `X-Nexus-Page-View` headers that the React tracker adds when `propagateHeaders` is on (opt-in). |
| IP / PII | `IP_STORAGE_MODE = full \| truncated \| hashed` (**default `full`**, because the user asked for IPs). Geo is always resolved from the full IP *before* storage. Query strings, bodies and tokens are never stored. Emails are masked in **logs**. In the dashboard, IPs are visible to admins only. |
| Retention | `RAW_RETENTION_MONTHS` (default **6**). A SECURITY DEFINER function `drop_expired_partitions()` runs plain `DETACH PARTITION` + `DROP` with `lock_timeout 2s`, nightly at 02:30 IST. On `55P03` it retries at the next tick. `CONCURRENTLY` is **not** used, because it is forbidden inside functions and transactions. |
| Dashboard access | Env policy in `@nexus/auth`, read identically by web and api. `DASHBOARD_ALLOWED_EMAILS` (explicit allowlist, fail-closed). If it is empty, `DASHBOARD_ALLOWED_DOMAINS` applies (default `libas.in`). `DASHBOARD_ADMIN_EMAILS` (admins manage apps/keys and see IPs). `MeDto = {email, isAdmin}`. |
| Live contract | Namespace `SOCKET_NAMESPACES.live = '/live'`. Client: `live:subscribe {app?: slug}` / `live:unsubscribe`. Server: `traffic:tick` every `LIVE_TICK_MS = 2000` (**cumulative current-minute** counts + activeUsers), `traffic:events` (≤1 batch/s, ≤100 events, role-masked), `live:session-expired`. `GET /v1/live/snapshot` backfills the last 60 one-minute buckets plus recent events **from the DB**. |
| Dashboard queries | v1 reads **raw partitioned tables**. Ranges are capped: 31 d for percentiles, 93 d for counts. Buckets: sub-day `date_bin(stride, occurred_at, TIMESTAMPTZ '2000-01-01 00:00+05:30')`; day and up `date_trunc(unit, occurred_at, 'Asia/Kolkata')`. Repository signatures stay stable, so v1.1 rollups change only repository internals. |
| Postgres / roles | `postgres:17-alpine` (YAML anchor shared with pg-backup). Schema `traffic`. `migrate` connects as `POSTGRES_USER` (owner). On **every run** it bootstraps idempotently: `CREATE SCHEMA IF NOT EXISTS traffic`, create role `nexus_app` if missing, `ALTER ROLE nexus_app PASSWORD $NEXUS_APP_DB_PASSWORD`. The api connects as `nexus_app`, which has DML only plus EXECUTE on the partition functions. **No initdb scripts**, because those run only on an empty volume. |
| Licences | `ua-parser-js` pinned to `^1` (MIT; 2.x is AGPL). geoip-lite bundled data. The Geography page shows the MaxMind GeoLite2 attribution. |


## Why (the main reasons)

| Decision | Why |
|---|---|
| Synchronous ingest | ~1 event/s average volume; a buffered writer could lose up to 50k events on a crash/redeploy, could not report `duplicates`, and broke the service → repository ctrl-click hop. |
| `occurred_at` verbatim + reject out-of-window | `occurred_at` is in the primary key; clamping/shifting it per retry made retries insert duplicates. |
| Monthly partitions, no default partition | retention = drop a month instead of deleting millions of rows; a default partition blocks creating overlapping partitions later and escapes retention. |
| Identity ranking, only verified sources fill `user_email` | the publishable key is public — anyone could forge `user.email`; forged users must not inflate counts or impersonate people. |
| `user_key` / `endpoint_id` stored at ingest | URLs must never contain emails (gateway logs); one-way ids cannot be resolved later unless stored. |
| Base path `/traffic`, nginx strips it for api/socket | matches the AgreementVault precedent; one layout across api, web, compose, docs. |
| Roles: migrate as owner, api as `nexus_app` | an injection bug in the api cannot become DDL/DROP; partition DDL runs through whitelisted SECURITY DEFINER functions. |
| Bootstrap in `migrate` instead of initdb scripts | initdb scripts run only on an empty volume and cannot read env passwords. |
| Raw-table queries in v1 | the expected volume is small; rollups add a whole subsystem of failure modes. Repository signatures stay stable so v1.1 rollups change only repository internals. |
| `ua-parser-js@^1` | 2.x is AGPL-3.0. |

## Consequences

- `packages/shared` must be updated first for any contract change, then migrations, then the API, then
  the docs (`docs/integration/`, `docs/CHANGELOG.md`).
- Parity tests fail the build when a zod limit/enum and a DB CHECK disagree.
