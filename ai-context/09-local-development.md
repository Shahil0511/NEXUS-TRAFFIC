# 09 — Local development (`npm run dev`, the EBO_SALES way)

Same shape as `D:\server\EBO_SALES` (read-only reference): a one-time setup, then **one command that
runs the api and the dashboard side by side** with `concurrently`. **No sign-in in dev**: `next dev`
signs you in as `DEV_USER_EMAIL` automatically (like EBO's `DEV_USER_EMAIL`), so the dashboard just opens.

```bash
npm install          # once
npm run dev:setup    # once (and after a dev DB reset): dev DB, migrations, apps/api/.env, apps/web/.env.local
npm run dev          # every day: [api] tsx watch on :4000 + [web] next dev on :3000; Ctrl+C stops both
```

Open **http://localhost:3000/traffic/** — signed in as `admin@libas.in` (admin), no login page.

| Script | What it runs |
|---|---|
| `npm run dev` | `build:shared`, then `concurrently` → `npm run dev -w @nexus/api` + `npm run dev -w @nexus/web` |
| `npm run dev:api` / `npm run dev:web` | one side only |
| `npm run dev:setup` | [`scripts/dev/setup.ts`](../scripts/dev/setup.ts): `.env.dev` secrets → dev DB container (:55434) → builds → migrations → writes the two env files |
| `npm run dev:launcher` | the older all-in-one launcher with the Dev Launcher page (described below; optional) |

**Env files (EBO's `backend/.env` + `frontend/.env.local`)** — both git-ignored and docker-ignored,
written by `dev:setup`:
- `apps/api/.env`: every api + migrate key with dev values. The api loads it **before** the root `.env`
  (dotenv never overrides), so the root `.env` (compose / production values) cannot leak in.
- `apps/web/.env.local`: every web key + `DEV_USER_EMAIL`. `next dev` loads it before `next.config.ts`
  loads the root `.env`.

**How the dev sign-in works:** `apps/web/src/proxy.ts` `devSignInToken` — only when `NODE_ENV` is
`development` (i.e. `next dev`) and `DEV_USER_EMAIL` is set — signs an `access_token` with the dev
`LIBAS_JWT_SECRET` (`@nexus/auth` `signAccessToken`) and sets it as a cookie. The api and the Live socket
then verify it with the normal production code. `next start` / the Docker image never do this.

Ports: **3000** dashboard, **4000** api, **55434** dev DB. The docker rehearsal uses 3305 / 4005 / 8080,
so both can run at the same time.

---

## The Dev Launcher (`npm run dev:launcher`, optional)

The code lives in [`scripts/dev/`](../scripts/dev/) (entry: [`scripts/dev/index.ts`](../scripts/dev/index.ts)).

### Prerequisites

- **Node 22 or newer** (`node -v`), npm 10+.
- **Docker Desktop running.** If it is not running you get *"Start Docker Desktop, then run npm run dev again"*.
- Free ports **4000** (api) and **3000** (dashboard). The launcher picks the next free port when 3399 is busy.

### What `npm run dev:launcher` does, step by step

| # | Step | Details | Module |
|---|---|---|---|
| 1 | Dev settings | Creates the git-ignored **`.env.dev`** on the first run, with fresh random hex secrets (`API_KEY_PEPPER`, `USER_KEY_SECRET`, `IP_HASH_SECRET`, `LIBAS_JWT_SECRET`, `NEXUS_APP_DB_PASSWORD`, `DEV_DB_PASSWORD`). Later runs reuse it. | [`env-file.ts`](../scripts/dev/env-file.ts) |
| 2 | Dev Launcher | Starts the local page on `http://localhost:3399` right away, so you can watch the rest start. | [`launcher-server.ts`](../scripts/dev/launcher-server.ts) |
| 3 | Dev database | Docker container **`nexus-traffic-devdb`** (`postgres:18-alpine`, volume `nexus-traffic-devdata`, `127.0.0.1:55434`, database `nexus_traffic_dev`). Created if missing, started if stopped, reused if running. Waits for `pg_isready`. | [`docker-db.ts`](../scripts/dev/docker-db.ts) |
| 4 | Builds (in parallel with 3) | `npm run build:shared` (Next.js reads `@nexus/shared` / `@nexus/auth` from `dist`) and `npm run docs:build` (the public guide). A failed build is a warning, not a stop. | [`build.ts`](../scripts/dev/build.ts) |
| 5 | Migrations | The api's migrate CLI with `DB_APP_ROLE_MODE=separate`: it creates role `nexus_app` (DML only), applies the SQL migrations and creates partitions. **A failure stops the run.** | [`migrate.ts`](../scripts/dev/migrate.ts) |
| 6 | API | `tsx watch` on port 4000 (restarts when you save a file). Waits for `/api/health`. | [`servers.ts`](../scripts/dev/servers.ts) |
| 7 | Dashboard | `npm run dev -w @nexus/web` (Next.js on port 3000). If `apps/web` is not ready, or its dev server exits, everything else keeps running and the launcher says *"dashboard not available yet"*. | [`servers.ts`](../scripts/dev/servers.ts) |
| 8 | Browser | Prints a summary box with every URL and opens the launcher (skip with `--no-open`). | [`open-browser.ts`](../scripts/dev/open-browser.ts) |

Every line in the terminal has a coloured prefix (`[db]`, `[migrate]`, `[api]`, `[web]`, `[launcher]`).

**Ctrl+C** stops the api, the dashboard and the launcher (including their child processes; on Windows
with `taskkill /T`). The dev database **keeps running**, so the next start is quick.

Options (put them after `--`): `npm run dev:launcher -- --no-open --no-web --port 3400`.

| Option | Effect |
|---|---|
| `--no-open` | do not open the browser |
| `--no-web` | api + launcher only, no dashboard |
| `--port <n>` | preferred launcher port (the next free one is used if it is busy) |

## The Dev Launcher page (`http://localhost:3399`)

- **Status cards**, refreshed every 3 s: dev database (Docker state and TCP), API (`/api/health` and
  `/api/health/ready`), dashboard (`/traffic/healthz`), with ports and green/amber/red dots. Below the
  cards is the start sequence, step by step.
- **Quick links:** dashboard `http://localhost:3000/traffic/`, API health, the public integration guide
  `http://localhost:4000/api/docs/`, and the OpenAPI JSON.
- **Sign in (dev token):** there is no company portal locally. *Sign in as admin* (the email in the box,
  default `admin@libas.in`) or *Sign in as viewer* (`viewer@libas.in`). The launcher signs an `access_token`
  (HS256, 8 hours) with the dev `LIBAS_JWT_SECRET` and sets it as an HttpOnly cookie for `localhost`.
  Cookies are not tied to a port, so the dashboard (:3000) and the api (:4000) accept it. The dashboard
  is configured with `PORTAL_LOGIN_URL=http://localhost:3399/`, so opening it signed out takes you to the
  launcher with a **"Sign in to continue"** banner, and sends you back after you sign in. Admins are
  `admin@libas.in` plus your `git config user.email` if it ends in `@libas.in`.
  Use `localhost`, not `127.0.0.1`, in the browser: the cookie belongs to the host name.
- **Seed demo data:** creates app `demo-app` ("Demo App", base path `/demo`) through the real admin
  API, plus one secret and one publishable key. The keys are saved in `.env.dev` (`DEMO_SECRET_KEY`,
  `DEMO_PUBLISHABLE_KEY`). The page shows only their prefixes, with a *Copy* button. Running it again
  reuses the app and the keys.
- **Send sample traffic:** generates realistic server events for `demo-app` (several routes, GET, POST,
  PATCH and DELETE, mostly 2xx with some 4xx/5xx, log-normal durations, a few `@libas.in` users, public
  IPs for geo, spread over the last 6 hours). It checks every batch against the shared ingest schema, then
  posts batches of up to 500 to the real ingest route with the demo secret key, and shows
  accepted/duplicates/rejected.
- **Logs:** the last 200 lines of each process (api, web, migrate, db, build, launcher).
- **Stop all:** the same as Ctrl+C.

**Safety:** the launcher listens on `127.0.0.1` only, refuses to start with `NODE_ENV=production`,
answers only to `Host: localhost:<port>` / `127.0.0.1:<port>`, rejects cross-origin POSTs and needs an
`X-Dev-Launcher: 1` header for its actions. It never prints secrets, only masked prefixes. The sign-in
`return` link is followed only to `http://localhost` / `http://127.0.0.1`. A dev token is useless
anywhere else, because the dev `LIBAS_JWT_SECRET` is random per laptop.

## Ports

| Port | What | Bound to |
|---|---|---|
| 55434 | dev Postgres (`nexus-traffic-devdb`) | 127.0.0.1 |
| 4000 | api (`/api/*`, the guide at `/api/docs/`) | all interfaces (Node default) |
| 3000 | dashboard (`/traffic/`, `/traffic/api/*` is rewritten to the api in dev) | Next.js default |
| 3399 | Dev Launcher (next free port if busy) | 127.0.0.1 |

Ports used by **other** setups, which `npm run dev` never touches: 55432 / 55433 (the DB test containers
`nexus-traffic-testdb` / `nexus-traffic-testdb18`), and 4005 / 3305 / 8080 for the docker rehearsal.
The dev dashboard uses 3000, so the rehearsal (3305) and `npm run dev` can run together.

## Stopping and resetting

| Command | Effect |
|---|---|
| Ctrl+C (or *Stop all*) | stops api, dashboard, launcher; the DB keeps running |
| `npm run dev:stop` | also stops a running `npm run dev` gracefully, then stops the DB container (data kept) |
| `npm run dev:reset` | after typing `yes` (or `-- --yes`): stops everything, **deletes** the container and the `nexus-traffic-devdata` volume, removes the `DEMO_*` keys from `.env.dev`. The dev secrets are kept; delete `.env.dev` yourself for new ones. |

## Environment: how values reach each process

- `.env.dev` (repo root, git-ignored via `.env.*`, also excluded by `.dockerignore`) holds only dev values.
- The tooling **never reads or changes the root `.env`.** That file belongs to the docker rehearsal and
  production.
- The api / migrate (`dotenv`) and `next dev` (`process.loadEnvFile`) *also* look at the root `.env`, but
  neither overrides a variable that is already set. [`scripts/dev/child-env.ts`](../scripts/dev/child-env.ts)
  therefore passes **every** key those apps read explicitly, even empty ones such as
  `DASHBOARD_ALLOWED_EMAILS=`. That way nothing from the root `.env` can leak into the dev environment.
  When you add an env var to [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts) or
  [`apps/web/src/env.schema.ts`](../apps/web/src/env.schema.ts), add its dev value there too.
- API paths in the tooling come from `ROUTES` in [`packages/shared/src/routes.ts`](../packages/shared/src/routes.ts),
  like everywhere else.

## Troubleshooting

| Symptom | Fix |
|---|---|
| *"Docker is not available … Start Docker Desktop"* | start Docker Desktop, wait until it says *running*, run `npm run dev` again |
| *"port 4000 is already in use"* | another api is running (an older `npm run dev`, `npm run dev -w @nexus/api`, or something else). Stop it, or run `npm run dev:stop` |
| launcher on another port | 3399 was busy; the summary box and the log show the port actually used |
| dashboard card red, *"dashboard not available yet"* | look at the `[web]` logs on the launcher. Typical causes: `apps/web` is not finished yet, port 3000 is taken, or a compile error. The api and launcher keep working |
| migrations fail with *password authentication failed* | `.env.dev` was recreated but the old DB volume is still there (the launcher warns about this). Run `npm run dev:reset -- --yes`, then `npm run dev` |
| migrations fail otherwise | read the `[migrate]` output. It is the same CLI as production (`apps/api/src/db/migrate.ts`); fix the migration and run again |
| api card red but the process is running | the api crashed at boot; `tsx watch` restarts it when you save a file. Check the `[api]` logs (e.g. a config error lists every bad key) |
| *"No demo key yet"* on Send sample traffic | click *Seed demo data* first |
| dashboard still asks you to sign in after signing in | use `http://localhost:…` (not `127.0.0.1`) so the cookie is sent |
| start fresh | `npm run dev:reset -- --yes` and delete `.env.dev` |

## How this differs from the docker rehearsal and production ([ADR 0002](decisions/0002-external-database.md))

| | `npm run dev` (this page) | Docker rehearsal | Production (TL server) |
|---|---|---|---|
| Command | `npm run dev` | `docker compose --profile localdb --profile local up -d --build` | `bash scripts/deploy.sh` |
| Database | container `nexus-traffic-devdb`, `nexus_traffic_dev` on 127.0.0.1:55434 | compose `postgres` service (profile `localdb`), not published | external **10.150.0.5** / `nexus_traffic` |
| Role mode | `separate` (api as `nexus_app`) | `separate` | `owner` |
| Settings | `.env.dev` (generated, dev only) | root `.env` | root `.env` on the server |
| Sign-in | Dev Launcher mints a dev token | portal cookie (or none) | company portal |
| Code | source, hot reload (`tsx watch`, `next dev`) | built images | built images |

**Never point a laptop at the production database** (10.150.0.5). The dev tooling has no setting that
could do so: its database URL is always the local container.

Related: [06-process.md](06-process.md) (tests, Docker, deploy) · [02-architecture.md](02-architecture.md).
