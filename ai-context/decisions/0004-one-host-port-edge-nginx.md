# ADR 0004 — One host port: an edge nginx in front of api + web; handoff as a zip

- **Status:** accepted (2026-10-05); implemented 2026-10-05 (see [PROGRESS.md](../PROGRESS.md)):
  `docker-compose.yml` (service `edge`, `NEXUS_PORT` / `NEXUS_BIND_ADDRESS`; api and web no longer
  published), `ops/nginx/edge.conf` (was the local-only gateway copy), `ops/nginx/nexus-traffic.conf`
  (gateway side, now one upstream), `scripts/deploy.sh` (works without `.git`), `scripts/preflight.sh`
  (checks `NEXUS_PORT`), `scripts/handoff/make-handoff-zip.ps1`, root `HANDOFF.md`.
- **Context:** the first design published two loopback ports (api `127.0.0.1:4005`, web
  `127.0.0.1:3305`) and needed four location blocks in the gateway nginx on the same host, plus a
  `git clone` on the server. The user hosts it the way EBO_SALES is hosted: they zip the folder for the
  Team Lead, who builds it with Docker Compose and **assigns one port**; the gateway forwards the app's
  prefix to that port with the path kept (EBO: `/ebo-sales/*` → web `:3302`).
- **Decision:**
  1. The `edge` nginx (formerly profile `local` only) is always on and is the **only** published port:
     `${NEXUS_BIND_ADDRESS:-0.0.0.0}:${NEXUS_PORT:-8080}:80`. It routes `/traffic/api/` and
     `/traffic/socket.io/` → `api:4000` (prefix stripped) and `/traffic/` → `web:3000` (path kept).
  2. The gateway needs one upstream (`http://<host>:NEXUS_PORT`, path kept), with a websocket block for
     `/traffic/socket.io/`.
  3. Two proxies now sit in front of the api → `.env.example` sets `TRUST_PROXY_HOPS=2` (the schema
     default stays 1 for `npm run dev`). Edge passes the gateway's `X-Forwarded-Proto` through.
  4. Handoff = a zip of the working tree without `node_modules`, build output, dev env files or `.git`,
     with the production `.env` added as `.env` (the user's choice: the TL only runs compose).
- **Consequences:**
  - A fresh port is one `.env` value; nothing else changes. The local rehearsal is now
    `docker compose --profile localdb up -d --build` (no profile `local`).
  - With `NEXUS_BIND_ADDRESS=0.0.0.0` the port is reachable without the gateway: anyone who can reach it
    could forge `X-Forwarded-For` (→ wrong client IP/geo, not access: the dashboard still needs the
    portal cookie, ingest still needs a key). Firewall it to the gateway, or use `127.0.0.1` when the
    gateway runs on the same host.
  - The zip carries live secrets (DB password, portal JWT secret, HMAC peppers): send it like a password.
