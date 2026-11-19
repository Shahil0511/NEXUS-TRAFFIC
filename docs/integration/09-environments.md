# Environments and configuration

## Server variables

| Variable | Value | Notes |
|---|---|---|
| `NEXUS_URL` | `{{PUBLIC_URL}}` | base URL, **without** `/api`. Unset → the snippets do nothing. |
| `NEXUS_SECRET_KEY` | `nx_sk_…` | secret — server environment / secret manager only |
| `NEXUS_ENVIRONMENT` | optional: {{ENVIRONMENT_VALUES}} | sent as the batch's `environment`. Unset → we store `{{DEFAULT_ENVIRONMENT}}`. Any other value is **not sent** (the SDKs log one warning). |
| `NEXUS_RELEASE` | optional, e.g. a git sha | copied into each event's `release` |

Leaving `NEXUS_URL` empty is the right default for local development, unit tests and CI: the client
becomes a no-op and never opens a connection.

## Environments: prod, staging, dev

Every event is stored with an **environment** — {{ENVIRONMENT_VALUES}}. The dashboard shows
**production only** unless a viewer picks another one (the *Environment* filter, `?env=` in the URL;
`all` shows everything). Staging and laptop traffic can therefore share an app and its keys without
polluting the production numbers.

| Source | How the environment is decided |
|---|---|
| server batch | the envelope's `environment` if it is valid, else `{{DEFAULT_ENVIRONMENT}}`. Never guessed from an IP (a proxy can make production traffic look local). |
| browser batch | `dev` when the **page** runs on `localhost`, `*.localhost`, `*.local`, `127.x.x.x` or `[::1]` — whatever it claims. Otherwise the valid claim, else `{{DEFAULT_ENVIRONMENT}}`. |

- An unknown value (a typo such as `production`) never fails the batch: it is ignored with a
  `FIELD_DROPPED` warning (field `environment`) and the batch counts as `{{DEFAULT_ENVIRONMENT}}`.
- Set it **per deployment**: `NEXUS_ENVIRONMENT=staging` on the staging backend,
  `NEXT_PUBLIC_NEXUS_ENVIRONMENT=staging` / `VITE_NEXUS_ENVIRONMENT=staging` in the staging frontend build.
- The **Live** page, "who's online" and the live counters are always production only. The
  Integration page is not filtered — it shows the environment mix, so you can check staging is
  wired too.
- A separate app `<slug>-dev` (e.g. `ebo-sales-dev`) with its own keys and origins is **still
  allowed** ([chapter 1](01-getting-keys.md)) — use it when you do not want developer origins on the
  production app, or want a separate kill switch.
- Data sent before an app started sending `environment` counts as production.
- Never point a developer laptop at production with the production key.
- Always use `https://` across machines; plain `http://` is only for `localhost` and the internal
  Docker network described at the end of this chapter.

## Frontend build-time variables

Browser code can only read variables that were **baked in at build time**. Only the
**publishable** key may ever go here.

| Framework | URL variable | Key variable | Optional |
|---|---|---|---|
| Next.js | `NEXT_PUBLIC_NEXUS_URL` | `NEXT_PUBLIC_NEXUS_KEY` | `NEXT_PUBLIC_NEXUS_ENVIRONMENT`, `NEXT_PUBLIC_NEXUS_RELEASE` |
| Vite | `VITE_NEXUS_URL` | `VITE_NEXUS_KEY` | `VITE_NEXUS_ENVIRONMENT`, `VITE_NEXUS_RELEASE` |

In Next.js keep `process.env.NEXT_PUBLIC_…` **literal** in your code — Next only inlines a literal
property access. A release label is usually the git sha of the build
(`NEXT_PUBLIC_NEXUS_RELEASE=$(git rev-parse --short HEAD)` in your deploy script).

If your frontend image is built by Docker, pass them as **build arguments** — setting them only at
container run time is too late:

```dockerfile
# frontend Dockerfile — build stage, BEFORE `npm run build`
ARG NEXT_PUBLIC_NEXUS_URL
ARG NEXT_PUBLIC_NEXUS_KEY
ARG NEXT_PUBLIC_NEXUS_ENVIRONMENT
ARG NEXT_PUBLIC_NEXUS_RELEASE
ENV NEXT_PUBLIC_NEXUS_URL=$NEXT_PUBLIC_NEXUS_URL \
    NEXT_PUBLIC_NEXUS_KEY=$NEXT_PUBLIC_NEXUS_KEY \
    NEXT_PUBLIC_NEXUS_ENVIRONMENT=$NEXT_PUBLIC_NEXUS_ENVIRONMENT \
    NEXT_PUBLIC_NEXUS_RELEASE=$NEXT_PUBLIC_NEXUS_RELEASE
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
        NEXT_PUBLIC_NEXUS_ENVIRONMENT: ${NEXUS_ENVIRONMENT:-prod}
        NEXT_PUBLIC_NEXUS_RELEASE: ${NEXUS_RELEASE:-}
```

> **Never** put the secret key (`nx_sk_…`) in a `NEXT_PUBLIC_*` or `VITE_*` variable: it would ship to
> every browser. It would also be refused (`SECRET_KEY_EXPOSED`) and flagged for rotation.

## Content-Security-Policy

If your site sends a CSP header, the browser tracker needs to reach our API:

- apps on `https://nexus.libas.in` → `connect-src 'self'` already covers it (same origin);
- anything else → add `https://nexus.libas.in` to `connect-src`.

## CORS and propagated headers

The browser endpoints handle their own CORS for your registered origins — nothing to do on your
side. Their **error** answers are readable by every registered origin too, so a tracker on another
origin can see a kill code ([chapter 3](03-browser-contract.md)).

The tracker adds `X-Nexus-Session` and `X-Nexus-Page-View` to your app's **same-origin** `fetch`
and XHR calls by default, so backend and frontend events can be linked. Same-origin calls need no
CORS change.

For an API on **another origin**, opt in per origin with `propagateHeadersTo: ['https://api.example.com']`
— and add `X-Nexus-Session` and `X-Nexus-Page-View` to **that** API's `Access-Control-Allow-Headers`
first, or the browser blocks the call.

API calls made before the tracker mounts, and clients that keep their own copy of `fetch`
(`openapi-fetch`), need the early install — see [chapter 8](08-recipes.md).

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
