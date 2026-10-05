# Environments and configuration

## Server variables

| Variable | Value | Notes |
|---|---|---|
| `NEXUS_URL` | `{{PUBLIC_URL}}` | base URL, **without** `/api`. Unset → the snippets do nothing. |
| `NEXUS_SECRET_KEY` | `nx_sk_…` | secret — server environment / secret manager only |
| `NEXUS_RELEASE` | optional, e.g. a git sha | copied into each event's `release` |

Leaving `NEXUS_URL` empty is the right default for local development, unit tests and CI: the client
becomes a no-op and never opens a connection.

## Staging and local development

- Use a **separate app** for anything that is not production: `<slug>-dev` (e.g. `ebo-sales-dev`),
  with its own keys and origins like `http://localhost:3000` (see [chapter 1](01-getting-keys.md)).
  Production dashboards then stay clean.
- Never point a developer laptop at production with the production key.
- Always use `https://` across machines; plain `http://` is only for `localhost` and the internal
  Docker network described at the end of this chapter.

## Frontend build-time variables

Browser code can only read variables that were **baked in at build time**. Only the
**publishable** key may ever go here.

| Framework | URL variable | Key variable |
|---|---|---|
| Next.js | `NEXT_PUBLIC_NEXUS_URL` | `NEXT_PUBLIC_NEXUS_KEY` |
| Vite | `VITE_NEXUS_URL` | `VITE_NEXUS_KEY` |

If your frontend image is built by Docker, pass them as **build arguments** — setting them only at
container run time is too late:

```dockerfile
# frontend Dockerfile — build stage, BEFORE `npm run build`
ARG NEXT_PUBLIC_NEXUS_URL
ARG NEXT_PUBLIC_NEXUS_KEY
ENV NEXT_PUBLIC_NEXUS_URL=$NEXT_PUBLIC_NEXUS_URL \
    NEXT_PUBLIC_NEXUS_KEY=$NEXT_PUBLIC_NEXUS_KEY
RUN npm run build
```

```dockerfile
# Vite
ARG VITE_NEXUS_URL
ARG VITE_NEXUS_KEY
ENV VITE_NEXUS_URL=$VITE_NEXUS_URL \
    VITE_NEXUS_KEY=$VITE_NEXUS_KEY
RUN npm run build
```

```yaml
# docker-compose.yml of your app
services:
  web:
    build:
      context: .
      args:
        NEXT_PUBLIC_NEXUS_URL: ${NEXT_PUBLIC_NEXUS_URL:-}
        NEXT_PUBLIC_NEXUS_KEY: ${NEXT_PUBLIC_NEXUS_KEY:-}
```

> **Never** put the secret key (`nx_sk_…`) in a `NEXT_PUBLIC_*` or `VITE_*` variable: it would ship to
> every browser. It would also be refused (`SECRET_KEY_EXPOSED`) and flagged for rotation.

## Content-Security-Policy

If your site sends a CSP header, the browser tracker needs to reach our API:

- apps on `https://nexus.libas.in` → `connect-src 'self'` already covers it (same origin);
- anything else → add `https://nexus.libas.in` to `connect-src`.

## CORS and propagated headers

The browser endpoint handles its own CORS for your registered origins — nothing to do on your side.
When the tracker's optional `propagateHeaders` is on, it adds `X-Nexus-Session` and
`X-Nexus-Page-View` to **your own** API calls so backend and frontend events can be linked. If your
backend has an explicit CORS `allowedHeaders` list, add those two headers to it.

The tracker does this by wrapping `window.fetch` when it mounts. An API client that **captures
`fetch` when it is created** (at module load, before the tracker mounts) keeps calling the
unwrapped one, and nothing gets linked — `openapi-fetch`'s `createClient()` does this by default.
Give such a client a fetch that is looked up on every call:

```ts
// openapi-fetch
export const api = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) });
```

To check: in the browser's network tab your own `/api/…` requests must carry `X-Nexus-Session`.

## When containers cannot reach nexus.libas.in

Some servers cannot call their own public hostname from inside Docker ("hairpin" DNS / NAT). Check
from the server:

```bash
docker run --rm curlimages/curl -sS -o /dev/null -w '%{http_code}\n' {{VERIFY_URL}}
```

`401` means the network path works (no key was sent). A timeout or DNS error means it does not. In
that case, if your app runs on the **same Docker host** as Nexus, ask {{DOCS_CONTACT}} to enable the
shared Docker network `nexus-ingest`; your compose file then joins it and uses the internal address:

```yaml
services:
  api:
    networks: [default, nexus-ingest]
    environment:
      NEXUS_URL: http://nexus-traffic-api:4000     # internal: no /traffic prefix, no TLS
networks:
  nexus-ingest:
    external: true
```
