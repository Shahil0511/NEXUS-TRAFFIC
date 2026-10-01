# Getting keys

Each app is registered once and receives its own keys. Registration takes a few minutes on our side.

## Request your app

Send this to **{{DOCS_CONTACT}}** (copy, fill in, send):

```text
Subject: Data Nexus Traffic — register <your app>

App name (display):     EBO Sales
Slug (public id):       ebo-sales            ← lower-case letters, digits, dashes; 2–63 chars
Public base path:       /ebo-sales           ← the prefix of your app on nexus.libas.in
Browser origins:        https://nexus.libas.in
Browser tracking:       yes / no
Keys needed:            secret (server) + publishable (browser)
Technical contact:      name.surname@libas.in
Stack:                  e.g. Express 4 (TypeScript, ESM) + Next.js 16
```

- **Slug** — the stable public id of your app in the dashboard, URLs and filters. It must match
  `^[a-z0-9][a-z0-9-]{1,62}$`.
- **Base path** — every browser event's `path` must start with it (we reject events for paths
  outside your app with `PATH_OUTSIDE_APP`).
- **Browser origins** — the `Origin` your frontend runs on. For apps on `nexus.libas.in` this is just
  `https://nexus.libas.in`. Up to 20 origins, scheme + host (+ port), no path.

### Staging and local development

There is **no environment field**. Register a separate app for non-production use, with the suffix
`-dev` (e.g. `ebo-sales-dev`) and origins such as `http://localhost:3000`. Its data stays separate
from production. See [chapter 9](09-environments.md).

## The two kinds of key

| | Secret key | Publishable key |
|---|---|---|
| Looks like | `nx_sk_` + 40 letters/digits (46 chars) | `nx_pk_` + 32 letters/digits (38 chars) |
| Used by | your **backend** → `POST /v1/ingest/server` | your **frontend** → `POST /v1/ingest/browser` |
| Sent in | the `X-Nexus-Key` request header | the `key` field of the JSON body |
| Where to keep it | server environment variable `NEXUS_SECRET_KEY` | build-time variable (`NEXT_PUBLIC_NEXUS_KEY`, `VITE_NEXUS_KEY`) |
| Secret? | **Yes.** Never in a browser bundle, a repo, a log or a ticket. | No — it can only *write* browser events for your origins. |

> **We show a secret key exactly once**, when it is created. Store it in your secret manager / server
> `.env` straight away. If it is lost, we issue a new one.

> **A secret key sent to the browser endpoint is rejected** with `403 SECRET_KEY_EXPOSED` and flagged
> as exposed on our side. Treat it as leaked: ask for a new key and rotate.

Both kinds also work on `GET /v1/ingest/verify`, which tells you which app and kind a key belongs to.

## Storing keys

```bash
# backend .env (never committed)
NEXUS_URL={{PUBLIC_URL}}
NEXUS_SECRET_KEY=nx_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# frontend build-time variables (publishable key only)
NEXT_PUBLIC_NEXUS_URL={{PUBLIC_URL}}
NEXT_PUBLIC_NEXUS_KEY=nx_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Add the variable names (with empty values) to your repository's `.env.example` so the next developer
knows they exist. Without `NEXUS_URL` the reference snippets do nothing at all, which is the right
default for local development and tests.

## Rotation and revocation

An app can have several active keys at once, so rotation needs no downtime:

1. Ask for a **new** key (same kind).
2. Deploy your app with the new key.
3. We **expire** the old key at an agreed time (a grace period), or **revoke** it immediately if it
   leaked.

Requests with an expired or revoked key get `401 INVALID_API_KEY`.
