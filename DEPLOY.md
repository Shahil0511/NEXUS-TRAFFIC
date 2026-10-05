# DEPLOY — Data Nexus Traffic on the nexus.libas.in host

Runbook for the Team Lead. Every command runs **in the repo root on the server** (bash). Budget: ~30 min
the first time, ~5 min per update. **Received a zip?** [HANDOFF.md](HANDOFF.md) is the short version
(`.env` is already filled). Background: [ai-context/06-process.md](ai-context/06-process.md),
database decision: [ADR 0002](ai-context/decisions/0002-external-database.md), one-port layout:
[ADR 0004](ai-context/decisions/0004-one-host-port-edge-nginx.md).

Only ONE host port is published: the `edge` nginx on `NEXUS_PORT` (`.env`, default 8080). The gateway
forwards `/traffic/…` there with the path kept; edge routes it inside the stack:

| Public URL | Served by (inside the stack, via edge) |
|---|---|
| `https://nexus.libas.in/traffic/` | dashboard (container `web`) |
| `https://nexus.libas.in/traffic/api/` | ingest + dashboard API + guide (container `api`) |
| `https://nexus.libas.in/traffic/socket.io/` | live updates (websocket, same `api` container) |
| `https://nexus.libas.in/traffic/api/docs/` | **the integration guide link you send to the other teams** |

Data lives on the external Postgres **10.150.0.5**, database `nexus_traffic`, schema `traffic`
(already created and migrated; no postgres container runs in production).

## 1. Prerequisites (once)

- Docker Engine + **Compose v2.20+** (`docker compose version`; the old `docker-compose` v1 does not work).
- `curl`, `bash` (`git` only when deploying from a checkout); ≥ 5 GB free disk; **one free host port**
  for `NEXUS_PORT`.
- The gateway nginx for `nexus.libas.in` can reach that port: same host (`NEXUS_BIND_ADDRESS=127.0.0.1`,
  safest) or another host (`0.0.0.0`, the default — then firewall the port to the gateway).
- TCP from this host to `10.150.0.5:5432`, and the `nexus_traffic` owner login + password.
- The portal's JWT secret (`JWT_SECRET_KEY` of the portal = our `LIBAS_JWT_SECRET`).

## 2. Configure `.env` (once)

```bash
git clone <repo-url> nexus-traffic && cd nexus-traffic     # or: git pull --ff-only on main
cp .env.example .env
chmod 600 .env
```

Edit `.env`; replace **every** `change-me` value. The production (owner mode) values:

| Key | Value |
|---|---|
| `NEXUS_PORT` | the host port you assign (default 8080) |
| `NEXUS_BIND_ADDRESS` | `127.0.0.1` if the gateway is on this host, else `0.0.0.0` (default) |
| `TRUST_PROXY_HOPS` | `2` (gateway + edge; the template default) |
| `DB_APP_ROLE_MODE` | `owner` (already the template default) |
| `MIGRATION_DATABASE_URL` | `postgres://<login>:<url-encoded-password>@10.150.0.5:5432/nexus_traffic` |
| `DATABASE_URL` | **identical** to `MIGRATION_DATABASE_URL` (owner mode) |
| `NEXUS_APP_DB_PASSWORD`, `BACKUP_DATABASE_URL` | leave empty |
| `POSTGRES_*` | ignored in production (local container only) |
| `LIBAS_JWT_SECRET` | the portal's JWT secret |
| `API_KEY_PEPPER`, `USER_KEY_SECRET`, `IP_HASH_SECRET` | three **different** values, each `openssl rand -hex 32` |
| `DASHBOARD_ADMIN_EMAILS` | comma-separated admins (manage apps/keys, see IPs) |
| `DASHBOARD_ALLOWED_EMAILS` / `_DOMAINS` | explicit allowlist, or empty + domain `libas.in` |
| `PORTAL_LOGIN_URL`, `PORTAL_RETURN_PARAM` | the portal login URL and its return-URL parameter |
| `DOCS_CONTACT` | who teams contact for keys (shown in the guide) |

**URL-encode the password** inside the two URLs: `@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`, `%`→`%25`.
Docker Compose also expands `$` in `.env`: write a literal `$` as `$$`.
The secrets (`API_KEY_PEPPER`, `USER_KEY_SECRET`, `IP_HASH_SECRET`) must **never change** once data
exists: they hash keys, user ids and IPs. Keep a copy of `.env` in the team's password vault.

```bash
bash scripts/preflight.sh          # must end with 0 FAIL (it lists every problem, not just the first)
```

## 3. Gateway nginx (once)

Paste the three `location` blocks of [`ops/nginx/nexus-traffic.conf`](ops/nginx/nexus-traffic.conf)
**inside** the existing `server { … }` block of `nexus.libas.in` (the TLS one) and replace
`NEXUS_HOST:NEXUS_PORT` with this host and the port from `.env`. All three go to the same upstream with
the **path kept** (no rewrite); the edge nginx splits api / websocket / dashboard:

- `/traffic/socket.io/` → `http://NEXUS_HOST:NEXUS_PORT` with `Upgrade` / `Connection "upgrade"`, read timeout 3600 s
- `/traffic/` and `= /traffic` → `http://NEXUS_HOST:NEXUS_PORT`

If that server block uses `auth_request` (portal SSO at the gateway), **uncomment `auth_request off;`**
in all three blocks: other teams' servers post events to `/traffic/api/` with an API key and must never
get a login redirect. The dashboard does its own SSO check.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. First deploy

```bash
bash scripts/deploy.sh             # preflight → git pull --ff-only → docker compose up -d --build → health
```

(By hand: `docker compose up -d --build`.) Order: `migrate` runs and must exit 0 (no-op on the already
migrated database), then `api` (healthy), then `web` (healthy), then `edge`; `pg-backup` starts its
nightly schedule. From an unpacked zip (no `.git`) the script skips the pull and deploys the files on disk.
If `migrate` fails, the previous api keeps running: `docker compose logs migrate`.

## 5. Health checks

```bash
docker compose ps                                              # api, web, edge healthy; migrate "Exited (0)"
curl -fsS http://127.0.0.1:${NEXUS_PORT:-8080}/traffic/api/health/ready   # DB + schema + partitions (via edge)
curl -fsS http://127.0.0.1:${NEXUS_PORT:-8080}/traffic/healthz
curl -fsS https://nexus.libas.in/traffic/api/health            # through the gateway
curl -fsS -o /dev/null -w '%{http_code}\n' https://nexus.libas.in/traffic/api/docs/          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://nexus.libas.in/traffic/                     # 307 to the portal (no cookie)
curl -s -o /dev/null -m 3 -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'https://nexus.libas.in/traffic/socket.io/?EIO=4&transport=websocket'                      # 101 (curl then times out: fine)
```

Then open `https://nexus.libas.in/traffic/` in a browser while logged in to the portal: the Overview loads.

## 6. First app + keys, smoke test

1. Log in as an address in `DASHBOARD_ADMIN_EMAILS` → **Apps** → *Register app* (slug e.g. `ebo-sales`,
   base path e.g. `/ebo-sales`, allowed origins e.g. `https://nexus.libas.in`).
2. *Create key* → **secret** (server) and **publishable** (browser). The full secret is shown **once**:
   store it, then confirm "I have stored the key".
3. Smoke test from the server (writes one test event to that app):
   ```bash
   NEXUS_SECRET_KEY=nx_sk_… bash docs/snippets/curl.sh
   # verify 200 → dry run 202 → send "accepted":1 → resend "duplicates":1
   ```
4. Hairpin check — can containers reach the public URL? (other teams' containers need this):
   ```bash
   docker run --rm curlimages/curl -fsS https://nexus.libas.in/traffic/api/v1/ingest/verify -H 'X-Nexus-Key: nx_sk_…'
   ```
   If it fails, use the `nexus-ingest` network fallback (commented in `docker-compose.yml`, guide chapter 09).
5. Send the teams the guide link and their keys (one app per team; staging = its own slug, e.g. `ebo-sales-dev`).

## 7. Updates and rollback

```bash
bash scripts/deploy.sh                                       # update to the latest main
git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh     # rollback to a known-good commit
git checkout main                                            # back on main afterwards
```

Migrations are additive, so running older code on a newer schema is safe (`migrate` only warns about
"unknown applied" migrations). Logs: `docker compose logs -f api migrate web`.

## 8. Background jobs (inside the api, nothing to schedule)

- **Partitions:** every 6 h the api ensures monthly partitions from last month to 2 months ahead
  (`/api/health/ready` fails if no future partition exists).
- **Retention:** nightly 02:30–03:30 IST it drops monthly partitions older than `RAW_RETENTION_MONTHS`
  (default 6) via `traffic.drop_expired_partitions` — logged as `retention run`.

## 9. Backups and restore

`pg-backup` dumps `BACKUP_DATABASE_URL` (empty = `MIGRATION_DATABASE_URL`) nightly at `BACKUP_AT_IST`
(01:30) to `./backups/nexus-traffic-YYYY-MM-DD.dump` (pg_dump custom format) and keeps the newest
`BACKUP_KEEP` (14). **Copy `./backups` off this machine regularly.**

```bash
export MSYS_NO_PATHCONV=1   # only in Git Bash on Windows; harmless elsewhere
docker compose exec pg-backup sh /ops/backup/run.sh --once          # manual dump now
docker compose logs --tail 20 pg-backup                             # schedule + results
```

Restore (replaces the schema `traffic` of `nexus_traffic`; nothing else on 10.150.0.5 is touched):

```bash
docker compose stop api web                                         # no writes during the restore
docker compose exec pg-backup sh /ops/backup/restore.sh /backups/nexus-traffic-YYYY-MM-DD.dump
docker compose up -d                                                # migrate (no-op) → api → web
```

[`ops/backup/restore.sh`](ops/backup/restore.sh) renames the live schema to `traffic_before_restore`,
restores the dump in one transaction, then drops the old schema; if the restore fails it renames the
old schema back, so the database is unchanged. (Plain `pg_restore --clean` does NOT work on the
partitioned tables.) Rehearsed on the local stack in S6.

## 10. Disk, GeoIP, secrets

- Disk: container logs rotate (10 MB × 5 per service); data volume = the external DB; dumps in `./backups`.
- GeoIP: the `geoip-lite` database ships inside the api image; it refreshes when the dependency is
  updated and the image rebuilt (no MaxMind key needed in v1). Cities are "approximate".
- Key leak: revoke it on the Apps page (takes effect within seconds), create a new one, send it to the team.
  A secret key used in a browser is flagged "exposed" on Apps and Integration.

## 11. Open questions for the TL (defaults chosen; tell us if any is wrong)

1. Is the gateway nginx on this host? Can containers resolve and reach `nexus.libas.in` (step 6.4)?
2. Does the portal's `access_token` cookie have `Path=/` (so `/traffic/` receives it)? Login URL and
   return parameter name (`PORTAL_LOGIN_URL`, `PORTAL_RETURN_PARAM`)?
3. Does the gateway apply `auth_request` site-wide? Then `/traffic/api/` and `/traffic/socket.io/` must be exempt (step 3).
4. Which host port is Nexus Traffic's (`NEXUS_PORT`, preflight checks it is free)?
5. Who goes in `DASHBOARD_ADMIN_EMAILS` / `DASHBOARD_ALLOWED_EMAILS`, and who is `DOCS_CONTACT`?
6. Is 10.150.0.5 already backed up by its owners (then `./backups` is a second copy)?
