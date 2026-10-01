# 06 — process

> **Partly filled (S1):** local development and Docker are below. Test strategy details, git
> workflow, the full deploy runbook and rollback for the Team Lead are completed in S6.

See [README.md](README.md) for the reading order and [PROGRESS.md](PROGRESS.md) for status.

## Local development

Prerequisites: Node 22+, npm 10+, Docker Desktop / Docker Engine with Compose v2.20+.

```bash
npm install                                   # all workspaces
cp .env.example .env                          # then replace every change-me value (hex secrets)
docker compose up -d postgres migrate         # database + migrations only
npm run dev -w @nexus/api                     # api on http://localhost:4000 (tsx watch, shared from src)
```

- `apps/api/src/config/index.ts` loads `.env` from the repo root, so the same file serves compose and
  local runs. For a local api, point `DATABASE_URL` at a reachable Postgres (the compose `postgres`
  is not published on the host; use a throwaway container or temporarily publish it).
- Shared packages resolve to `packages/*/src` in dev (`--conditions=@nexus/source`), so no
  `build:shared` is needed while developing.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | vitest unit tests in every workspace |
| `RUN_DB_TESTS=1 npm run test:db` | api DB tests (`*.integration.test.ts`) against a real Postgres |
| `npm run docs:build` | renders `docs/integration/*.md` → `docs/dist/` (guide, openapi.json, snippets, examples) |
| `npm run openapi:emit` | regenerates `docs/openapi.json` (commit it); `-- --check` fails if stale |
| `npm run env:example` | regenerates `.env.example` from the api env schema; `-- --check` fails if stale |

The guide is then at `http://localhost:4000/api/docs/` (served from `docs/dist`).

**Adding an env var:** add it to `apps/api/src/config/env.schema.ts`, describe it in `SECTIONS` of
`scripts/generate-env-example.ts` (the script fails otherwise), run `npm run env:example`, commit both.
`apps/api/test/env-example.test.ts` enforces this.

## Docker

| File | Role |
|---|---|
| `apps/api/Dockerfile` | multi-stage (deps → build → prod-deps → runtime), repo-root context, non-root `app`, tini |
| `docker-compose.yml` | `postgres`, `migrate` (one-shot), `api`, `pg-backup`, `edge` (profile `local`); `web` placeholder for S2 |
| `ops/nginx/nexus-traffic.conf` | location blocks the TL pastes into the gateway nginx |
| `ops/nginx/local.conf` | the same blocks for the local `edge` service (`/traffic/` answers 503 until S2) |
| `ops/backup/run.sh` | nightly `pg_dump` at 01:30 IST, keeps 14 (`--once` for a manual dump) |
| `scripts/preflight.sh` | checks Compose ≥ 2.20, `.env` completeness and hex secrets, ports 3305/4005, disk ≥ 5 GB |
| `scripts/deploy.sh` | preflight → `git pull --ff-only` → `docker compose up -d --build --remove-orphans` → health checks |

```bash
docker compose --profile local up -d --build  # full stack + local gateway on http://localhost:8080
#   http://localhost:8080/traffic/api/health        → 200
#   http://localhost:8080/traffic/api/docs/         → the guide
#   NEXUS_URL=http://localhost:8080/traffic NEXUS_SECRET_KEY=nx_sk_… bash docs/snippets/curl.sh
docker compose logs -f api migrate
docker compose --profile local down           # keeps the data volume (add -v ONLY on a dev machine)
```

- Order on every `up`: `postgres` healthy → `migrate` exits 0 → `api` starts → `edge`. A failed
  migration leaves the previous api running.
- The api image also runs `migrate` (`node dist/db/migrate.js`); compose tags it
  `nexus-traffic-api:local` and never pulls it.
- **Lockfile:** `package-lock.json` must contain the Linux (musl) optional binaries. After changing
  dependencies on Windows, regenerate it inside Alpine, then run a normal `npm install`:
  `docker run --rm -v "$PWD:/w" -w /w node:22-alpine npm install --package-lock-only --no-audit --no-fund`.
- Server deploy (TL): `bash scripts/preflight.sh` once, then `bash scripts/deploy.sh` for every update;
  rollback = `git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh` (migrations are additive).
- Backups land in `./backups` on the host (git-ignored); restore instructions are in
  `ops/backup/run.sh`.
