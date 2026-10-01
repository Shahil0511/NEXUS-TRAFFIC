# 06 — process

> **Partly filled (S1, S2):** local development (api + web dashboard) and Docker are below. Test strategy details, git
> workflow, the full deploy runbook and rollback for the Team Lead are completed in S6.

See [README.md](README.md) for the reading order and [PROGRESS.md](PROGRESS.md) for status.

## Local development

Prerequisites: Node 22+, npm 10+, Docker Desktop / Docker Engine with Compose v2.20+.

```bash
npm install                                   # all workspaces
cp .env.example .env                          # localdb values: DB_APP_ROLE_MODE=separate, hex secrets
docker compose --profile localdb up -d postgres migrate   # local database + migrations only
npm run dev -w @nexus/api                     # api on http://localhost:4000 (tsx watch, shared from src)
```

- `apps/api/src/config/index.ts` loads `.env` from the repo root, so the same file serves compose and
  local runs. For a local api, point `DATABASE_URL` at a reachable Postgres (the compose `postgres`
  is not published on the host; use a throwaway container or temporarily publish it).
- **Never point a laptop at the production server** (10.150.0.5 / `nexus_traffic`); the TL runs
  migrations there through the normal deploy.
- Shared packages resolve to `packages/*/src` in dev (`--conditions=@nexus/source`), so no
  `build:shared` is needed while developing.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | vitest unit tests in every workspace |
| `RUN_DB_TESTS=1 npm run test:db` | api DB tests (`*.integration.test.ts`) against a real Postgres (`TEST_PG_ADMIN_URL`, a superuser URL of a THROWAWAY cluster; run them on **18** — the production major — and 17) |
| `npm run docs:build` | renders `docs/integration/*.md` → `docs/dist/` (guide, openapi.json, snippets, examples) |
| `npm run openapi:emit` | regenerates `docs/openapi.json` (commit it); `-- --check` fails if stale |
| `npm run env:example` | regenerates `.env.example` from the api env schema; `-- --check` fails if stale |

The guide is then at `http://localhost:4000/api/docs/` (served from `docs/dist`).

### Web dashboard (S2)

```bash
npm run build:shared                          # once: next.config.ts imports PUBLIC_BASE_PATH from the shared dist
npm run dev -w @nexus/api                     # the dashboard API on :4000 (see above)
npm run dev -w @nexus/web                     # Next on http://localhost:3305/traffic/ (basePath in dev too)
npx tsx scripts/mint-dev-token.ts you@libas.in   # prints a LOCAL access_token (8 h, signed with .env LIBAS_JWT_SECRET)
```

- **Sign in locally:** there is no portal on a laptop. Mint a token with `scripts/mint-dev-token.ts` and
  set it as a cookie: DevTools → Application → Cookies → `http://localhost` → name `access_token`,
  path `/` (cookies ignore the port, so it works on :3305 and on the edge :8080). `--set-cookie-header`
  prints a `Set-Cookie` value instead (for curl: `-H "Cookie: access_token=…"`). The script never prints
  the secret; the email must pass `DASHBOARD_ALLOWED_EMAILS` / `DASHBOARD_ALLOWED_DOMAINS`.
  Without a valid cookie `apps/web/src/proxy.ts` redirects to `PORTAL_LOGIN_URL`.
- `next dev` reads the repo-root `.env` (`apps/web/next.config.ts`) and rewrites `/traffic/api/*` to
  `API_INTERNAL_URL` (default `http://localhost:4000`) — ONLY in development; in Docker nginx routes
  `/traffic/api/` to the api.
- Env of the web container (`apps/web/src/env.schema.ts`, zod `.strip()`): `LIBAS_JWT_SECRET`,
  `PORTAL_LOGIN_URL`, `PORTAL_RETURN_PARAM` (`return`), `PUBLIC_ORIGIN` (the SSO return URL is built from
  it, never from the Host header), `DASHBOARD_ALLOWED_EMAILS` / `_DOMAINS` / `_ADMIN_EMAILS`.
- Gates: `npm run typecheck -w @nexus/web`, `npm test -w @nexus/web` (vitest + Testing Library + MSW:
  `src/lib/*.test.ts`, `src/proxy.test.ts` with a TEST secret, view tests under `src/features/`),
  `npm run build -w @nexus/web` (must print the route table; `.next/standalone/apps/web/server.js` exists).
- `apps/web/src/lib/api.test.ts` fails when a dashboard ROUTES leaf has no `api.*` function: when a step
  adds a leaf to the client, remove it from `PENDING_LEAVES` there (mirror of `EXPECTED_PENDING` in
  `apps/api/test/routes-contract.test.ts`).

**Adding an env var:** add it to `apps/api/src/config/env.schema.ts`, describe it in `SECTIONS` of
`scripts/generate-env-example.ts` (the script fails otherwise), run `npm run env:example`, commit both.
`apps/api/test/env-example.test.ts` enforces this.

## Docker

| File | Role |
|---|---|
| `apps/api/Dockerfile` | multi-stage (deps → build → prod-deps → runtime), repo-root context, non-root `app`, tini |
| `apps/web/Dockerfile` | multi-stage (deps → build: `build:shared` + `next build` → runtime: `.next/standalone` + static + public), non-root `nextjs`, tini, `CMD node apps/web/server.js`; build ARG `NEXT_PUBLIC_SOCKET_PATH` |
| `docker-compose.yml` | `postgres` (profile `localdb` only), `migrate` (one-shot), `api`, `pg-backup`, `web` (env allowlist, `127.0.0.1:3305:3000`, healthcheck `/traffic/healthz`), `edge` (profile `local`) |
| `ops/nginx/nexus-traffic.conf` | location blocks the TL pastes into the gateway nginx |
| `ops/nginx/local.conf` | the same blocks for the local `edge` service (`/traffic/api/` + `/traffic/socket.io/` → api, `/traffic/` and `= /traffic` → web) |
| `ops/backup/run.sh` | nightly `pg_dump "$BACKUP_DATABASE_URL" -Fc` at 01:30 IST, keeps 14 (`--once` for a manual dump) |
| `scripts/preflight.sh` | checks Compose ≥ 2.20, `.env` completeness per `DB_APP_ROLE_MODE`, hex secrets, URL-encoded passwords, TCP reachability of the database, ports 3305/4005, disk ≥ 5 GB (`--localdb` for the local stack) |
| `scripts/deploy.sh` | preflight → `git pull --ff-only` → `docker compose up -d --build --remove-orphans` → health checks |

Two ways to run the stack ([ADR 0002](decisions/0002-external-database.md)):

| | Command | Database | `.env` |
|---|---|---|---|
| production (TL server) | `docker compose up -d --build` (via `bash scripts/deploy.sh`) | external 10.150.0.5 / `nexus_traffic` | `DB_APP_ROLE_MODE=owner`, `DATABASE_URL` = `MIGRATION_DATABASE_URL`, password URL-encoded (`@` → `%40`) |
| fully local (laptop / CI) | `docker compose --profile localdb --profile local up -d --build` | `postgres:18-alpine` container | `DB_APP_ROLE_MODE=separate`, `POSTGRES_*`, `NEXUS_APP_DB_PASSWORD`; check with `bash scripts/preflight.sh --localdb` |

```bash
docker compose --profile localdb --profile local up -d --build  # full local stack + gateway on :8080
#   http://localhost:8080/traffic/api/health        → 200
#   http://localhost:8080/traffic/api/docs/         → the guide
#   http://localhost:8080/traffic/                  → the dashboard (needs the access_token cookie, see above)
#   NEXUS_URL=http://localhost:8080/traffic NEXUS_SECRET_KEY=nx_sk_… bash docs/snippets/curl.sh
docker compose logs -f api migrate
docker compose --profile localdb --profile local down  # keeps the data volume (add -v ONLY on a dev machine)
```

- Order on every `up`: (`postgres` healthy, localdb only) → `migrate` exits 0 → `api` healthy → `web` healthy → `edge`.
  A failed migration leaves the previous api running. `migrate` and `pg-backup` declare
  `depends_on: postgres` with `required: false`, so without the profile they go straight to the
  external database.
- The localdb volume is mounted at `/var/lib/postgresql` (the PG18 image layout). A volume created by
  the old `postgres:17` service cannot be reused: on a dev machine,
  `docker compose --profile localdb --profile local down -v` and start fresh.
- The api image also runs `migrate` (`node dist/db/migrate.js`); compose tags it
  `nexus-traffic-api:local` and never pulls it.
- **Lockfile:** `package-lock.json` must contain the Linux (musl) optional binaries. After changing
  dependencies on Windows, regenerate it inside Alpine, then run a normal `npm install`:
  `docker run --rm -v "$PWD:/w" -w /w node:22-alpine npm install --package-lock-only --no-audit --no-fund`.
- Server deploy (TL): `bash scripts/preflight.sh` once, then `bash scripts/deploy.sh` for every update;
  rollback = `git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh` (migrations are additive).
- Backups land in `./backups` on the host (git-ignored); restore instructions
  (`pg_restore -d "$BACKUP_DATABASE_URL" …`) are in `ops/backup/run.sh`. The shared server may also be
  backed up by its owners.
