# Recipes

Copy-paste reference code, one per stack. Each one builds the payload exactly as chapter 2
describes, batches (every {{FLUSH_SECONDS}} s or {{FLUSH_EVENTS}} events, at most
{{SERVER_MAX_EVENTS}} per request), follows the retry rules of chapter 4 and **never throws into your
app**. Download the files or copy them from below.

| Stack | File | Notes |
|---|---|---|
| Express 4/5 — plain JavaScript, CommonJS | [express-cjs.js](files/snippets/express-cjs.js) | zero dependencies, Node ≥ 18 |
| Express 4/5 — TypeScript, ESM / NodeNext | [express-esm.ts](files/snippets/express-esm.ts) | zero runtime dependencies |
| NestJS 10/11 | [nestjs.main.ts](files/snippets/nestjs.main.ts) | uses `express-esm.ts` via `app.use` |
| FastAPI / Starlette (Python 3.10+) | [fastapi_nexus_asgi.py](files/snippets/fastapi_nexus_asgi.py) | pure ASGI, needs `httpx` |
| Any language — check the contract | [curl.sh](files/snippets/curl.sh) | verify, dry run, send, resend |
| Next.js App Router frontend | [next-tracker.tsx](files/snippets/next-tracker.tsx) + [next-instrumentation-client.ts](files/snippets/next-instrumentation-client.ts) | `@nexus/react` ({{REACT_SDK_VERSION}}) |
| Vite / React Router frontend | [vite-react-tracker.tsx](files/snippets/vite-react-tracker.tsx) + [vite-nexus-early.ts](files/snippets/vite-nexus-early.ts) | `@nexus/react` ({{REACT_SDK_VERSION}}) |

**Prefer a package over a copied file?** The same logic ships as vendorable tarballs:
[`@nexus/express`](files/sdk/nexus-express-{{EXPRESS_SDK_VERSION}}.tgz) (Express 4/5 and NestJS; the
framework-free [`@nexus/node`](files/sdk/nexus-node-{{NODE_SDK_VERSION}}.tgz) client is bundled in) and
[`@nexus/react`](files/sdk/nexus-react-{{REACT_SDK_VERSION}}.tgz). Commit the tarball under `vendor/` and
depend on `"file:vendor/nexus-react-{{REACT_SDK_VERSION}}.tgz"`. Tarballs never change once published, so
your builds do not depend on nexus.libas.in.

All server recipes read these environment variables. Without `NEXUS_URL` they do nothing:

```bash
NEXUS_URL={{PUBLIC_URL}}
NEXUS_SECRET_KEY=nx_sk_…
NEXUS_ENVIRONMENT=prod        # optional: prod | staging | dev — unset → the server stores prod
NEXUS_RELEASE=a1b2c3d         # optional: your version / git sha
```

**Where to put the middleware:** as early as possible (so it sees every request, including 404s and
requests your auth rejects), but it reads the user **when the response finishes**, so it still sees
identity that later middleware attaches. Per-app anchors are in the
[appendix](appendix-per-app-hints.md).

**Three settings to get right** in every recipe:

| Setting | Meaning | Typical value |
|---|---|---|
| `basePath` | the public prefix of your app that the gateway **strips** before your code sees the path; `''` if your app sees the full public path | `/my-app` |
| `trustProxyHops` | proxies you run in front of this code — [chapter 6](06-client-ip.md) | 1 (gateway → app) or 2 (gateway → Next → app) |
| `getUser(req)` | your **verified** user's email — [chapter 7](07-user-email.md) | `req.user?.email` |

Call `await nexus.shutdown()` from your existing graceful-shutdown handler so the last batch is sent.
The snippets do not install signal handlers of their own.

## Express — plain JavaScript (CommonJS)

Save as `src/nexus.js`, then:

```js
const { createNexusClient, nexusMiddleware } = require('./nexus');

const nexus = createNexusClient({ url: process.env.NEXUS_URL, key: process.env.NEXUS_SECRET_KEY });
app.use(nexusMiddleware({
  client: nexus,
  basePath: '/my-app',
  trustProxyHops: 1,
  getUser: (req) => req.user && req.user.email,
}));
// … your routes …
```

Express fills `req.route` once a route matches, so `routeTemplate` comes out as
`/my-app/api/stores/:id` automatically, nested routers included (`req.baseUrl + req.route.path`).
Requests that match no route are still recorded (without a template). To report your app's error
code, set `res.locals.errorCode = 'VALIDATION_ERROR'` in your error handler (or pass `getErrorCode`).

{{snippet:express-cjs.js}}

## Express — TypeScript (ESM / NodeNext)

Save as `src/nexus.ts` and import it with your project's extension rule
(`import { … } from './nexus.js'` under NodeNext):

```ts
import { createNexusClient, nexusMiddleware } from './nexus.js';

const nexus = createNexusClient({ url: process.env.NEXUS_URL, key: process.env.NEXUS_SECRET_KEY });
app.use(nexusMiddleware({ client: nexus, basePath: '/my-app', trustProxyHops: 1, getUser: (req) => emailFrom(req) }));
```

It never mutates `req.query` (read-only in Express 5).

{{snippet:express-esm.ts}}

## NestJS

Nest runs on Express, so the same middleware applies with `app.use` in `main.ts` — **before**
`setGlobalPrefix`. That covers every request, including unmatched routes and guard rejections, which
an interceptor would miss.

{{snippet:nestjs.main.ts}}

## FastAPI / Starlette (Python)

`pip install httpx`, save as `app/nexus_asgi.py`. A **pure ASGI** class (not `BaseHTTPMiddleware`):
it adds no child task, so it can read context variables your other middleware sets, and it does not
buffer streaming responses. `trust_proxy_hops` has no default on purpose — you must count your
proxies.

```python
import os
from app.nexus_asgi import NexusClient, NexusASGIMiddleware

# environment defaults to NEXUS_ENVIRONMENT; it is sent only when it is prod, staging or dev.
nexus = NexusClient(os.getenv("NEXUS_URL"), os.getenv("NEXUS_SECRET_KEY"))  # or environment="staging"

# Starlette: the LAST middleware added is the OUTERMOST. Add Nexus BEFORE the middleware that sets
# your user context variable, so Nexus runs inside it and can read it at response end.
app.add_middleware(NexusASGIMiddleware, client=nexus, trust_proxy_hops=2, base_path="/my-app",
                   get_user=lambda scope: user_email_ctx.get(),
                   release=os.getenv("NEXUS_RELEASE"))
app.middleware("http")(request_context_middleware)

# lifespan / shutdown:
#     await nexus.aclose()
```

{{snippet:fastapi_nexus_asgi.py}}

## curl — any language

Use it to check a key, see a dry run and watch idempotency work (`duplicates: 1` on the resend).
Building your own sender in another language? Match what this script sends.

{{snippet:curl.sh}}

## Frontends (React, Next.js, Vite)

The React tracker `@nexus/react` does everything in [chapter 3](03-browser-contract.md): page views
with their route template, visible time, tool clicks, custom events, header propagation, retries
across page loads and the remote kill switch. Two pieces per app:

1. **The tracker**, mounted once in your client root (it needs the router).
2. **The early install** (`@nexus/react/early`), which puts the session headers on API calls made
   **before** the tracker mounts — without it the first requests of every page load cannot be linked.

Build-time variables (only the **publishable** key):

| | Next.js | Vite |
|---|---|---|
| URL | `NEXT_PUBLIC_NEXUS_URL={{PUBLIC_URL}}` | `VITE_NEXUS_URL={{PUBLIC_URL}}` |
| Key | `NEXT_PUBLIC_NEXUS_KEY=nx_pk_…` | `VITE_NEXUS_KEY=nx_pk_…` |
| Environment (optional) | `NEXT_PUBLIC_NEXUS_ENVIRONMENT` | `VITE_NEXUS_ENVIRONMENT` |
| Release (optional) | `NEXT_PUBLIC_NEXUS_RELEASE` | `VITE_NEXUS_RELEASE` |

Unset URL or key → the tracker does nothing (the right default for local development without Nexus).
A page on `localhost` is stored as `dev` anyway.

### Next.js (App Router)

Save `next-tracker.tsx` as `app/providers.tsx` (pass the same `basePath` as `next.config`), and
`next-instrumentation-client.ts` as `src/instrumentation-client.ts` (Next ≥ 15.3 runs it in the
browser before hydration). `<NexusTracker/>` builds `routeTemplate` from `useParams()` itself.
The core of [next-tracker.tsx](files/snippets/next-tracker.tsx) (download it for the full file,
including the optional user hint):

```tsx
// app/providers.tsx
'use client';
import { NexusTracker } from '@nexus/react/next';
import { Suspense, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <NexusTracker
          url={process.env.NEXT_PUBLIC_NEXUS_URL}
          publishableKey={process.env.NEXT_PUBLIC_NEXUS_KEY}
          basePath="/my-app" // same value as next.config basePath
          environment={process.env.NEXT_PUBLIC_NEXUS_ENVIRONMENT as 'prod' | 'staging' | 'dev' | undefined}
          release={process.env.NEXT_PUBLIC_NEXUS_RELEASE}
        />
      </Suspense>
      {children}
    </>
  );
}
```

{{snippet:next-instrumentation-client.ts}}

### Vite / React Router

Save `vite-nexus-early.ts` as `src/nexus-early.ts` and make `import './nexus-early';` the **first**
line of `src/main.tsx`. ES imports are hoisted: a call written in `main.tsx`'s body runs only after
every imported module — your API client included — which is too late. A module imported first runs
first. Render `<NexusTracking/>` once inside your router; it derives `routeTemplate` with
`matchRoutes()`.

{{snippet:vite-nexus-early.ts}}

{{snippet:vite-react-tracker.tsx}}

### API clients that capture `fetch`

Header propagation wraps `window.fetch` and `XMLHttpRequest`. A client that keeps its own reference
to `fetch` from **before** the wrapper exists (`openapi-fetch`'s `createClient()` does by default)
bypasses it. The early install fixes this when it runs first; if you cannot run it first, give the
client a fetch that is looked up on every call:

```ts
// openapi-fetch
export const api = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) });
```

To check: in the browser's network tab your own `/api/…` requests carry `X-Nexus-Session` and
`X-Nexus-Page-View`, and the Integration page's **Linked API calls** goes up.
