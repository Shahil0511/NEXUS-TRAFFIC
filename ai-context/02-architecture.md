# 02 — Architecture

## Big picture

```mermaid
flowchart LR
  subgraph Other teams' apps (not our code)
    BE[App backend\n+ Nexus middleware]
    FE[App frontend\n+ Nexus React hook]
  end
  subgraph nexus.libas.in gateway (nginx)
    NG[/traffic/api → api:4000/api\n/traffic/socket.io → api:4000/socket.io\n/traffic/ → web:3000/]
  end
  subgraph Data Nexus Traffic (docker compose)
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
  NG --> API
  NG --> WEB
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
- **Local laptop / CI / rehearsals:** `docker compose --profile localdb --profile local up -d --build`
  starts a `postgres:18-alpine` container and runs `DB_APP_ROLE_MODE=separate` (the api as `nexus_app`,
  DML only).

## Containers (docker-compose.yml)

| Service | Image | Port (host) | Job |
|---|---|---|---|
| `postgres` (profile `localdb` only) | postgres:18-alpine | not published | local database (volume `nexus-traffic-pgdata` at `/var/lib/postgresql`); production uses 10.150.0.5 instead |
| `migrate` | nexus-traffic-api:local | — | runs once per deploy: schema bootstrap (+ `nexus_app` role and grants in `separate` mode) + SQL migrations + partitions |
| `api` | nexus-traffic-api:local | 127.0.0.1:4005 → 4000 | ingest, dashboard REST API, Socket.io, public docs, jobs |
| `web` | built from apps/web | 127.0.0.1:3305 → 3000 | the dashboard |
| `pg-backup` | postgres:18-alpine | — | nightly `pg_dump "$BACKUP_DATABASE_URL" -Fc` (default: the migrate login), keeps 14 |
| `edge` (profile `local`) | nginx:1.27-alpine | 127.0.0.1:8080 | local-only copy of the gateway for full-stack testing |

## URLs

| Public URL | Reaches | Notes |
|---|---|---|
| `https://nexus.libas.in/traffic/` | web `/traffic/` | Next.js `basePath: '/traffic'` |
| `https://nexus.libas.in/traffic/api/*` | api `/api/*` | nginx strips `/traffic` |
| `https://nexus.libas.in/traffic/socket.io/` | api `/socket.io/` | websocket upgrade headers in nginx |
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

## Why these choices

See [decisions/0001-contract-and-naming.md](decisions/0001-contract-and-naming.md) and, for the
database location and role modes, [decisions/0002-external-database.md](decisions/0002-external-database.md).
