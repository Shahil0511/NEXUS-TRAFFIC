# 06 — process

How we run, test, commit, deploy and roll back. The Team Lead's runbook is [`DEPLOY.md`](../DEPLOY.md)
(repo root); this page is the developer view. For the one-command local setup see
[09-local-development.md](09-local-development.md).

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
| `npm run typecheck` | `tsc --noEmit` in every workspace, then `scripts/` (`scripts/tsconfig.json`) and `scripts/dev/` |
| `npm test` | vitest unit tests in every workspace |
| `RUN_DB_TESTS=1 npm run test:db` | api DB tests (`*.integration.test.ts`) against a real Postgres (`TEST_PG_ADMIN_URL`, a superuser URL of a THROWAWAY cluster; run them on **18** — the production major — and 17) |
| `npm run docs:build` | renders `docs/integration/*.md` → `docs/dist/` (guide, openapi.json, snippets, examples) |
| `npm run openapi:emit` | regenerates `docs/openapi.json` (commit it); `-- --check` fails if stale |
| `npm run env:example` | regenerates `.env.example` from the api env schema; `-- --check` fails if stale |
| `npm run test:smoke` | Playwright smoke of the RUNNING docker stack via `edge` (not part of `npm test`, see below) |

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
| `ops/backup/run.sh` | nightly `pg_dump "$BACKUP_DATABASE_URL" -Fc` at `BACKUP_AT_IST` (01:30 IST), keeps `BACKUP_KEEP` (14) (`--once` for a manual dump) |
| `ops/backup/restore.sh` | restore a dump into `BACKUP_DATABASE_URL` (schema `traffic` only, all-or-nothing) |
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
- Server deploy (TL): [`DEPLOY.md`](../DEPLOY.md) — `.env` (owner mode), `bash scripts/preflight.sh`, the gateway
  snippet, `bash scripts/deploy.sh`, health checks, first app + keys, backups/restore, open questions.
- Backups land in `./backups` on the host (git-ignored): `ops/backup/run.sh` (nightly at `BACKUP_AT_IST`, keeps
  `BACKUP_KEEP`, `--once` for a manual dump); restore with `ops/backup/restore.sh` (renames the live schema,
  restores in one transaction, puts the old schema back on failure — plain `pg_restore --clean` fails on the
  partitioned tables). The shared server may also be backed up by its owners.

## Tests

| Layer | Where | Runs in |
|---|---|---|
| unit (pure functions, services with fakes, middleware, jobs) | `*.test.ts` next to the file | `npm test` |
| contract (ROUTES ↔ route table ↔ web client, env example, snippets, docs build, ai-context links) | `apps/api/test/*.test.ts`, `apps/web/src/lib/api.test.ts`, `packages/node/src/snippets-payload.contract.test.ts` | `npm test` |
| security suite (no-DB part) | `apps/api/test/security/security.test.ts` (header table: every plan case → its test) | `npm test` |
| DB / e2e (real Postgres, as `nexus_app`) | `*.integration.test.ts` (`apps/api/test/db/`, `apps/api/test/e2e/`, `apps/api/test/security/`, services) | `RUN_DB_TESTS=1 npm run test:db` |
| browser smoke of the built stack | `apps/web/e2e/smoke.spec.ts` | `npm run test:smoke` |

**DB suites** need a THROWAWAY cluster (each suite creates and drops its own database). The two local test
containers (never the dev DB, never 10.150.0.5):

```bash
docker run -d --name nexus-traffic-testdb18 -e POSTGRES_PASSWORD=testpw -p 127.0.0.1:55433:5432 postgres:18-alpine  # once
TEST_PG_ADMIN_URL=postgres://postgres:testpw@127.0.0.1:55433/postgres RUN_DB_TESTS=1 npm run test:db   # PG 18 (production major)
RUN_DB_TESTS=1 npm run test:db      # default URL = nexus-traffic-testdb (postgres:17-alpine) on 127.0.0.1:55432
```

**Smoke** (Playwright, Chromium) against `http://localhost:8080/traffic` (override: `SMOKE_BASE_URL`):

```bash
docker compose --profile localdb --profile local up -d --build
npx playwright install chromium     # once per machine
npm run test:smoke                  # auth redirect, Overview, endpoint detail, Live tick, Apps as admin
```

It mints an admin cookie from the repo-root `.env` (`LIBAS_JWT_SECRET`, first `DASHBOARD_ADMIN_EMAILS`) and
registers/reuses the app `smoke-test` (writes a few events to the LOCAL database). Config:
`apps/web/e2e/playwright.config.ts`.

## Gates before every commit

```bash
npm run typecheck && npm test
RUN_DB_TESTS=1 npm run test:db                       # on 18 (see above) when SQL, migrations or repositories changed
npm run env:example -- --check && npm run openapi:emit -- --check && npm run docs:build
```

## Git

- One branch: `main`. Commit per implementation step, message `S<n>: <what>` (or a conventional summary for
  small follow-ups); end AI-assisted commits with the `Co-Authored-By` line.
- Every commit that changes architecture, contract, tables or conventions updates the matching ai-context file
  and adds a [PROGRESS.md](PROGRESS.md) entry (rule 5 in `CLAUDE.md`).
- Never commit `.env`, `backups/`, `docs/dist/`, `test-results/`.
- Push only after the user approved; the TL deploys from `main` (`git pull --ff-only` in `deploy.sh`).

## Deploy and rollback (summary of DEPLOY.md)

| Action | Command (repo root on the server) |
|---|---|
| first time | `.env` from `.env.example` → `bash scripts/preflight.sh` → paste `ops/nginx/nexus-traffic.conf` → `bash scripts/deploy.sh` |
| update | `bash scripts/deploy.sh` |
| rollback | `git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh` (migrations are additive; older code tolerates newer schema) |
| backup now | `docker compose exec pg-backup sh /ops/backup/run.sh --once` |
| restore | `docker compose stop api web` → `docker compose exec pg-backup sh /ops/backup/restore.sh /backups/<file>.dump` → `docker compose up -d` |

A schema change that is NOT additive (drop/rename a column) needs a two-step release and an ADR.
