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
| React / Next.js / Vite frontends | — | reference hook coming; follow [chapter 3](03-browser-contract.md) |

All server recipes read two environment variables. Without `NEXUS_URL` they do nothing:

```bash
NEXUS_URL={{PUBLIC_URL}}
NEXUS_SECRET_KEY=nx_sk_…
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

nexus = NexusClient(url=os.getenv("NEXUS_URL"), key=os.getenv("NEXUS_SECRET_KEY"))

# Starlette: the LAST middleware added is the OUTERMOST. Add Nexus BEFORE the middleware that sets
# your user context variable, so Nexus runs inside it and can read it at response end.
app.add_middleware(NexusASGIMiddleware, client=nexus, trust_proxy_hops=2, base_path="/my-app",
                   get_user=lambda scope: user_email_ctx.get())
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

The reference tracker hook is coming. It will be used like this:

```tsx
// Next.js App Router — inside your client providers component
<NexusTracker url={process.env.NEXT_PUBLIC_NEXUS_URL} publishableKey={process.env.NEXT_PUBLIC_NEXUS_KEY} />

// Vite + react-router
useNexusTracker({
  url: import.meta.env.VITE_NEXUS_URL,
  publishableKey: import.meta.env.VITE_NEXUS_KEY,
  pathname: useLocation().pathname,
});
```

Until it ships, follow the payload spec in [chapter 3](03-browser-contract.md). What you can do
today, with no risk:

- add the build-time variables of [chapter 9](09-environments.md) to your build;
- mark the UI features you want counted: `<button data-nexus-tool="audits.export-csv">`.
