# @nexus/express

Data Nexus Traffic middleware for **Express 4 and 5** (and NestJS through `app.use`). It records one
event per API request and sends them in batches to Nexus. It **never throws into your app and never
blocks a response**: if Nexus is down, events are retried per the contract and then dropped.

Zero runtime dependencies (the `@nexus/node` client is bundled in). Peer: `express ^4.17 || ^5`.
Node >= 18. Full guide: <https://nexus.libas.in/traffic/api/docs/>

## Install (vendored tarball)

Download `nexus-express-1.0.0.tgz` from
`https://nexus.libas.in/traffic/api/docs/files/sdk/nexus-express-1.0.0.tgz`, commit it under
`vendor/`, and reference it:

```json
{
  "dependencies": {
    "@nexus/express": "file:vendor/nexus-express-1.0.0.tgz"
  }
}
```

Versioned tarballs are immutable, so your builds never depend on nexus.libas.in being reachable.

## Use

```ts
import express from 'express';
import { createNexusClient, nexusMiddleware, registerShutdownFlush } from '@nexus/express';

const nexus = createNexusClient({
  url: process.env.NEXUS_URL, // https://nexus.libas.in/traffic (NO /api). Unset → no-op.
  key: process.env.NEXUS_SECRET_KEY, // nx_sk_… — server env ONLY. Unset → no-op.
});

const app = express();
app.use(
  nexusMiddleware({
    client: nexus,
    basePath: '/my-app', // public prefix your gateway strips ('' if none)
    trustProxyHops: 1, // gateway → app = 1; gateway → Next.js → app = 2
    getUser: (req) => req.user?.email, // your VERIFIED user, read when the response ends
  }),
);
// … your routers …

registerShutdownFlush(nexus); // or: await nexus.shutdown() in your own SIGTERM handler
```

CommonJS works the same: `const { createNexusClient, nexusMiddleware } = require('@nexus/express');`

NestJS: in `main.ts`, `app.use(nexusMiddleware({ client: nexus, basePath: '/my-app' }))` **before**
`app.setGlobalPrefix(...)`.

Mount it **early** (before your routers), so the duration covers the whole request.

## Options

| Option | Default | What it does |
|---|---|---|
| `client` | — | The client from `createNexusClient()`. |
| `basePath` | `''` | Public path prefix. Prefixed to `path` / `routeTemplate` unless the URL already starts with it. |
| `getUser` | `req.user?.email` | Your **verified** signed-in user's email. |
| `trustProxyHops` | `1` | Proxies you run in front of the app. The IP is read from the right of `X-Forwarded-For`. |
| `skip` | OPTIONS, `/health`, `/healthz`, `/ready`, `/live`, `/metrics`, `/favicon.ico`, static files, `/_next/`, `/assets/` | Replaces the default skip rule. |
| `extraSkip` | — | An extra rule on top of the default. |
| `classify` | `text/event-stream` or `Content-Disposition: attachment` → `stream` | Marks long-lived responses so they do not skew latency. |
| `trustIdentityHeader` | `false` | Read `X-Nexus-User` when `getUser` returns nothing. **Only** when your gateway overwrites that header — otherwise anyone can forge it. |
| `getErrorCode` | `res.locals.errorCode` | Your app's error **code** (e.g. `VALIDATION_ERROR`), never a message. |
| `release` | — | Your version label (e.g. a git sha). |

## What is recorded

`eventId`, `occurredAt` (request start), `method`, `path` (base path included, **no query string**),
`routeTemplate` (e.g. `/my-app/api/agreements/:id`, nested routers included), `status` (`499` if the
client hung up), `durationMs`, `ip`, `userEmail`, `requestId` (`X-Request-ID`), `userAgent`,
request/response bytes (`Content-Length`), `kind`, `errorCode`, and `sessionId` / `pageViewId` when
the frontend tracker sends `X-Nexus-Session` / `X-Nexus-Page-View`.

Never recorded: bodies, cookies, tokens, query strings, error messages.

## Health and debugging

`nexus.stats()` → `{ queued, accepted, duplicates, rejected, dropped, attempts, paused, enabled }`.
Logs are prefixed `[nexus]` and throttled. `ingest URL is intercepted by a proxy` means an SSO page
or proxy answered instead of Nexus — check `NEXUS_URL` (guide chapter 11).
