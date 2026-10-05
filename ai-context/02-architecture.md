# 02 — Architecture

## Big picture

```mermaid
flowchart LR
  subgraph Other teams' apps (not our code)
    BE[App backend\n+ Nexus middleware]
    FE[App frontend\n+ Nexus React hook]
  end
  subgraph nexus.libas.in gateway (nginx)
    NG[/traffic/… → host:NEXUS_PORT, path kept/]
  end
  subgraph Data Nexus Traffic (docker compose)
    EDGE[edge nginx — the ONE published port\n/traffic/api, /traffic/socket.io → api:4000\n/traffic/ → web:3000]
    API[api — Express 5 + Socket.io]
    WEB[web — Next.js 16 dashboard]
    MIG[migrate — one-shot]
    BAK[pg-backup — nightly]
    LPG[(postgres 18 container\nONLY --profile localdb)]
  end
  subgraph Company Postgres server 10.150.0.5 (not ours)
    PG[(PostgreSQL 18\ndatabase nexus_traffic\nschema traffic)]
  end
  BE -- POST /traffic/api/v1/ingest/server\nX-Nexus-Key: nx_sk_… --> NG
  FE -- sendBeacon /traffic/api/v1/ingest/browser\nkey nx_pk_… + SSO cookie --> NG
  NG --> EDGE
  EDGE --> API
  EDGE --> WEB
  API --> PG
  MIG --> PG
  BAK --> PG
  API -.-> LPG
  MIG -.-> LPG
  WEB -- fetch /traffic/api/v1/… --> NG
  WEB -- websocket /traffic/socket.io --> NG
```

## Where the data lives ([ADR 0002](decisions/0002-external-database.md))

- **Production:** the company Postgres server **10.150.0.5** (PostgreSQL 18), in our own database
  **`nexus_traffic`**, schema `traffic`. No other database on that server is ever touched. Its login
  cannot create roles, so `.env` sets `DB_APP_ROLE_MODE=owner`: the api uses the same login as
  `migrate` (`DATABASE_URL` = `MIGRATION_DATABASE_URL`). The containers must reach 10.150.0.5:5432.
- **Local laptop / CI / rehearsals:** `docker compose --profile localdb up -d --build`
  starts a `postgres:18-alpine` container and runs `DB_APP_ROLE_MODE=separate` (the api as `nexus_app`,
  DML only).

## Containers (docker-compose.yml)

| Service | Image | Port (host) | Job |
|---|---|---|---|
| `postgres` (profile `localdb` only) | postgres:18-alpine | not published | local database (volume `nexus-traffic-pgdata` at `/var/lib/postgresql`); production uses 10.150.0.5 instead |
| `migrate` | nexus-traffic-api:local | — | runs once per deploy: schema bootstrap (+ `nexus_app` role and grants in `separate` mode) + SQL migrations + partitions |
| `api` | nexus-traffic-api:local | not published (api:4000) | ingest, dashboard REST API, Socket.io, public docs, jobs |
| `web` | built from apps/web | not published (web:3000) | the dashboard |
| `pg-backup` | postgres:18-alpine | — | nightly `pg_dump "$BACKUP_DATABASE_URL" -Fc` (default: the migrate login), keeps 14 |
| `edge` | nginx:1.27-alpine | `${NEXUS_BIND_ADDRESS}:${NEXUS_PORT}` (0.0.0.0:8080) | the ONLY published port: routes `/traffic/…` to api / web (`ops/nginx/edge.conf`, [ADR 0004](decisions/0004-one-host-port-edge-nginx.md)) |

Handoff: the Team Lead gets a zip from `scripts/handoff/make-handoff-zip.ps1` (source + the production
`.env`) and follows the repo-root `HANDOFF.md`; two proxies (gateway + edge) → `TRUST_PROXY_HOPS=2`.

## URLs

| Public URL | Reaches | Notes |
|---|---|---|
| `https://nexus.libas.in/traffic/` | web `/traffic/` | Next.js `basePath: '/traffic'` |
| `https://nexus.libas.in/traffic/api/*` | api `/api/*` | the edge nginx strips `/traffic` |
| `https://nexus.libas.in/traffic/socket.io/` | api `/socket.io/` | websocket upgrade headers in gateway AND edge |
| `https://nexus.libas.in/traffic/api/docs/` | api `/api/docs/` | **public guide link for other teams** |

## Lifecycle of a server event (ingest)

1. An app's middleware batches events and POSTs to `/v1/ingest/server` with its **secret key**.
2. `server-key-auth` checks the key (HMAC hash lookup), rate limits apply per key.
3. The envelope is validated; each event is validated **separately** (one bad event never fails the batch).
4. Enrichers run in order: path sanitizer → route normalizer → endpoint id → geo → IP anonymizer →
   user agent → identity → user key.
5. One `INSERT … ON CONFLICT DO NOTHING RETURNING` writes the batch (synchronous — no data lost on crash).
   Retries of the same `eventId` become `duplicates`.
6. Committed rows feed the live window → Socket.io `traffic:tick` / `traffic:events`.
7. The app gets `202 {accepted, duplicates, rejected[], warnings[]}`.

## Lifecycle of a dashboard request

Browser → `apps/web/src/lib/api.ts` (`request(ROUTES.x.y)`) → nginx → Express route table →
`ssoAuth` (verifies the `access_token` cookie) → `dashboardCsrf` (requires `X-Nexus-Dashboard: 1`) →
`validate*` → controller → service → repository → SQL → mapper → DTO → JSON → React Query cache →
component. The exact files are listed in [03-code-navigation.md](03-code-navigation.md).

## Real-time

- Namespace `/live`; client subscribes with `live:subscribe {app?}`.
- Every 2 s the server emits `traffic:tick` (cumulative counts for the *current minute*).
- New committed events are pushed in batches (`traffic:events`, ≤ 1/s).
- On (re)connect the dashboard loads `GET /v1/live/snapshot`, built from the database, so nothing is
  lost across restarts.
- **Auto-refresh of analytics pages** (`apps/web/src/features/live/useAutoRefresh.ts`, mounted once by
  the dashboard layout via `AutoRefresh.tsx`, off on the Live page): the same socket, scoped like the
  global app filter; every `traffic:events` batch (or a reconnect) invalidates the traffic-driven React
  Query keys (`autoRefreshPolicy.ts`: all except `me`, `apps`, `live`), throttled to one refresh per 5 s.
  Without it, pages kept their 60 s-stale data until the user navigated.
- End-to-end delay is bounded by the SDK flush interval (`SDK_DEFAULTS.*.flushIntervalMs` = 5 s):
  measured 4.6 s from an EBO_SALES request to its `traffic:events` in dev.

## Why these choices

See [decisions/0001-contract-and-naming.md](decisions/0001-contract-and-naming.md) and, for the
database location and role modes, [decisions/0002-external-database.md](decisions/0002-external-database.md).
