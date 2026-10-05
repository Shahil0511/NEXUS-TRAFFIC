# Data Nexus Traffic — Handoff (Team Lead)

Traffic analytics for the apps on `nexus.libas.in`, hosted the same way as EBO_SALES: **one folder,
one `docker compose up`, one port**, and the gateway forwards `/traffic/*` to that port.

- **web** — Next.js dashboard, `https://nexus.libas.in/traffic/`
- **api** — ingest + dashboard API + live websocket + the integration guide `https://nexus.libas.in/traffic/api/docs/`
- **edge** — nginx, the **only published port**; splits `/traffic/…` between api and web
- **migrate** (runs once per deploy) and **pg-backup** (nightly dump into `./backups`)

The data lives in the external Postgres **10.150.0.5**, database `nexus_traffic` (already created and
migrated). No database container runs. `.env` is **already filled in** for production.

## Run it — one command

Prereqs: **Docker Engine + Compose v2.20+** (`docker compose version`), network access from this host to
`10.150.0.5:5432`, ~5 GB free disk.

```bash
unzip nexus-traffic-handoff-*.zip && cd nexus-traffic
nano .env                     # set NEXUS_PORT to the port you assign (default 8080), save
docker compose up -d --build
```

First build takes a few minutes. Then:

```bash
docker compose ps             # api, web, edge "healthy"; migrate "Exited (0)"
curl -fsS http://127.0.0.1:<NEXUS_PORT>/traffic/api/health/ready
```

Optional, same thing with checks: `bash scripts/deploy.sh` (preflight → build → waits for health).

## Wire up the Nexus gateway

Forward `/traffic/*` to this host's `NEXUS_PORT` **without stripping the prefix** (like `/ebo-sales/*`).
Copy the three blocks from [`ops/nginx/nexus-traffic.conf`](ops/nginx/nexus-traffic.conf) into the
`nexus.libas.in` server block and replace `NEXUS_HOST:NEXUS_PORT`. In short:

```nginx
location ^~ /traffic/socket.io/ {            # live dashboard (websocket)
    proxy_pass http://<nexus-host>:<NEXUS_PORT>;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
location ^~ /traffic/ {                      # dashboard + API + ingest + guide
    proxy_pass http://<nexus-host>:<NEXUS_PORT>;   # keep the /traffic prefix — do NOT rewrite it away
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    client_max_body_size 1m;
}
location = /traffic { proxy_pass http://<nexus-host>:<NEXUS_PORT>; }   # full version in the .conf file
```

Two things matter:
1. **No portal `auth_request` on `/traffic/`** (add `auth_request off;` if the server block has it):
   other apps' servers send events to `/traffic/api/` with an API key and must never be redirected to a
   login. The dashboard does its own SSO check with the portal's `access_token` cookie.
2. **Keep `X-Forwarded-For`**: the api reads the real user IP from it (`TRUST_PROXY_HOPS=2` = gateway + edge).

`sudo nginx -t && sudo systemctl reload nginx`, then check:

```bash
curl -fsS https://nexus.libas.in/traffic/api/health                                        # {"status":"ok"…}
curl -s -o /dev/null -w '%{http_code}\n' https://nexus.libas.in/traffic/api/docs/          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://nexus.libas.in/traffic/                   # 307 → portal login
```

## Day to day

| Task | Command |
|---|---|
| Status / logs | `docker compose ps` · `docker compose logs -f api edge` |
| Update to a new zip | unzip over the folder **keeping `.env` and `backups/`**, then `docker compose up -d --build` |
| Change the port | edit `NEXUS_PORT` in `.env` → `docker compose up -d` → update the gateway `proxy_pass` |
| Stop / start | `docker compose down` · `docker compose up -d` (data is in 10.150.0.5, nothing is lost) |
| Manual backup | `docker compose exec pg-backup sh /ops/backup/run.sh --once` (files in `./backups`) |

## Notes

- `.env` holds **live secrets** (DB password, portal JWT secret, hashing secrets). Treat the zip and the
  folder as sensitive; `chmod 600 .env`. The three hashing secrets must **never change** once data exists.
- `NEXUS_BIND_ADDRESS=0.0.0.0` (default) lets a gateway on another machine reach the port. If the gateway
  runs on **this** host, set `127.0.0.1` (nobody can bypass the gateway). Otherwise firewall the port to
  the gateway only.
- Admins (register apps, issue API keys, see IPs): `DASHBOARD_ADMIN_EMAILS` in `.env`. Everyone with an
  `@libas.in` portal login can view.
- Full runbook (health checks, rollback, restore, open questions): [`DEPLOY.md`](DEPLOY.md).
