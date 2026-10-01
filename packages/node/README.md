# @nexus/node

The Data Nexus Traffic **server SDK** for Node.js >= 18. It queues server events and sends them in
batches to Nexus, following the contract's limits and retry rules. It **never throws into your app
and never blocks it**.

Using Express? Use `@nexus/express` (`nexus-express-1.0.0.tgz`) — it bundles this client and builds the
events for you. Use `@nexus/node` directly for other frameworks (Fastify, Koa, plain `http`, jobs).

Zero runtime dependencies. Full guide: <https://nexus.libas.in/traffic/api/docs/>

## Install (vendored tarball)

Download `https://nexus.libas.in/traffic/api/docs/files/sdk/nexus-node-1.0.0.tgz`, commit it under
`vendor/`, and reference it:

```json
{
  "dependencies": {
    "@nexus/node": "file:vendor/nexus-node-1.0.0.tgz"
  }
}
```

## Use

```ts
import { createEventId, createNexusClient, registerShutdownFlush, resolveClientIp } from '@nexus/node';

const nexus = createNexusClient({
  url: process.env.NEXUS_URL, // https://nexus.libas.in/traffic (NO /api). Unset → no-op.
  key: process.env.NEXUS_SECRET_KEY, // nx_sk_… — server env ONLY. Unset → no-op.
});
registerShutdownFlush(nexus);

// once per request, when the response has finished:
nexus.track({
  eventId: createEventId(), // create ONCE; retries reuse it (idempotency)
  occurredAt: startedAt.toISOString(), // request START
  method: 'GET',
  path: '/my-app/api/stores/42', // base path included, NO query string
  routeTemplate: '/my-app/api/stores/:id',
  status: 200,
  durationMs: 12.4,
  ip: resolveClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress, 1) ?? undefined,
  userEmail: verifiedUser?.email,
});
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `url` | — | `NEXUS_URL` without `/api`. Missing → no-op client. A plain `http://` URL that is not localhost logs one warning. |
| `key` | — | Secret key. Missing → no-op client. |
| `trustProxyHops` | `1` | Exposed as `client.trustProxyHops` for adapters. |
| `maxQueue` | `5000` | When full, the **oldest** events are dropped (counted in `stats().dropped`). |
| `flushEvents` | `100` | Send as soon as this many events are queued. |
| `flushIntervalMs` | `5000` | Send at least this often (the timer never keeps the process alive). |
| `requestTimeoutMs` | `5000` | Per-request timeout. |
| `fetch` | global `fetch` | Inject your own (proxy agents, tests). |
| `logger` | `console` | `{ warn, error? }`. Never receives keys or emails. |
| `disabled` | `false` | Force the no-op client. |

## Delivery rules (guide chapter 4)

Batches are at most 500 events and 512 KiB (split before sending; an event that alone is too
large is dropped). `sentAt` is re-stamped on every attempt; events are resent unchanged.

| Response | Action |
|---|---|
| `202` | Done — never retried. `rejected[]` is counted in `stats().rejected`. |
| `400`, `415`, other `4xx` | Drop the batch. |
| `401`, `403` | Keep the events, pause sending for 5 minutes. |
| `413` | Split in half and resend both halves. |
| `429`, `503` | Wait `Retry-After` (default 5 s, max 60 s) and resend. |
| other `5xx`, network error, timeout | Back off 1 s, 2 s (±20 % jitter); 3 attempts, then drop. |
| `3xx`, or a non-JSON `2xx`/`4xx` | A proxy/SSO is intercepting: drop, pause, log **once** `ingest URL is intercepted by a proxy`. |

## API

- `createNexusClient(options)` → `{ track(event), flush(), stats(), shutdown(deadlineMs = 5000), trustProxyHops, sdk }`
- `registerShutdownFlush(client, { signals?, deadlineMs? })` → flushes on SIGTERM/SIGINT/`beforeExit`; returns an unregister function. If your app has no handler of its own for the signal, the default exit still happens after the flush.
- `createEventId()` → a random UUID.
- `resolveClientIp(xForwardedFor, remoteAddress, trustProxyHops)` → the client IP, read from the right.
- `buildIngestUrl(nexusUrl, 'server' | 'browser' | 'verify')` → the absolute ingest URL.
