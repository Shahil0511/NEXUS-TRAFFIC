# @nexus/react

The reference **browser tracker** for Data Nexus Traffic. Add it once to your app's root and you
get page views, visible time on page, tool usage and custom events, all sent in the
[browser contract](https://nexus.libas.in/traffic/api/docs/) format.

- React 18 or 19. Next.js App Router via the `@nexus/react/next` entry; the pre-hydration header
  install via `@nexus/react/early`.
- **No runtime dependencies.** The contract constants are bundled in, and zod is never included.
- **It never throws into your app.** If storage is blocked or the network fails, it degrades quietly (failed batches are retried, then kept for the next page load).
- **It does nothing without config.** If `url` or `publishableKey` is missing (e.g. local dev), on the server, or when `disabled` is set, the tracker stays off.

## Install (vendored tarball)

Download `nexus-react-1.1.0.tgz` from the integration guide, commit it under `vendor/`, then:

```jsonc
// package.json
"dependencies": {
  "@nexus/react": "file:vendor/nexus-react-1.1.0.tgz"
}
```

Tarballs are versioned and never change once published, so your builds don't depend on
nexus.libas.in being reachable.

Set these **build-time** env vars. They are inlined into the bundle, so in Docker pass them as
`ARG` + `ENV` before the build step:

| Stack | URL (no `/api`) | Key (publishable `nx_pk_…`, **never** `nx_sk_…`) |
|---|---|---|
| Next.js | `NEXT_PUBLIC_NEXUS_URL=https://nexus.libas.in/traffic` | `NEXT_PUBLIC_NEXUS_KEY` |
| Vite | `VITE_NEXUS_URL=https://nexus.libas.in/traffic` | `VITE_NEXUS_KEY` |

If you use a Content-Security-Policy, add the Nexus origin to `connect-src`.

## Next.js (App Router)

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
          release={process.env.NEXT_PUBLIC_NEXUS_RELEASE}
        />
      </Suspense>
      {children}
    </>
  );
}
```

**`basePath`:** Next's `usePathname()` **leaves out** `next.config` `basePath`, but Nexus requires
every path to start with it (`PATH_OUTSIDE_APP` otherwise). `<NexusTracker/>` adds it back for you.
Pass `basePath` explicitly. If you leave it out, the tracker falls back to Next's build-time
`process.env.__NEXT_ROUTER_BASEPATH`, and then to `''`.

**Route template:** `<NexusTracker/>` rebuilds the route pattern (`/my-app/stores/:id`,
`/my-app/docs/:slug*`) from `usePathname()` and `useParams()`, so Nexus groups page views by the
real route instead of guessing. When a param value is missing or appears twice in the path, no
template is sent (Nexus then guesses, as before). A `routeTemplate` prop overrides it.

The full runnable file is `docs/snippets/next-tracker.tsx`.

## Vite / React Router

```tsx
import { useNexusTracker } from '@nexus/react';
import { useLocation } from 'react-router-dom';

const BASE_PATH = '/my-app';

export function NexusTracking() {
  const { pathname } = useLocation(); // leaves out the router basename, so prepend it
  useNexusTracker({
    url: import.meta.env.VITE_NEXUS_URL,
    publishableKey: import.meta.env.VITE_NEXUS_KEY,
    pathname: pathname === '/' ? BASE_PATH : BASE_PATH + pathname,
    // routeTemplate: from matchRoutes(routes, location), see the snippet
  });
  return null;
}
```

Render `<NexusTracking/>` once inside your router. The full file is
`docs/snippets/vite-react-tracker.tsx`; it also derives `routeTemplate` with `matchRoutes()`.

## Early install (`@nexus/react/early`)

The tracker mounts in a React effect, **after** hydration. API calls made before that (a data
client created at module load, the first `openapi-fetch` / axios request) would carry no
`X-Nexus-Session`, so the backend could not link them to the page view. `installNexusEarly()`
patches `fetch` and `XMLHttpRequest` right away; the tracker later adopts the same session and the
pre-allocated page-view id.

```ts
import { installNexusEarly } from '@nexus/react/early';

installNexusEarly({ url: …NEXUS_URL, publishableKey: …NEXUS_KEY });
```

- **Next.js ≥ 15.3:** save `docs/snippets/next-instrumentation-client.ts` as
  `src/instrumentation-client.ts`. Next runs it in the browser before hydration.
- **Vite / CRA:** save `docs/snippets/vite-nexus-early.ts` as `src/nexus-early.ts` and make
  `import './nexus-early';` the **first** import of `main.tsx`. ES imports are hoisted: a call
  written in `main.tsx`'s body runs only after every imported module (your API client included),
  which is too late. A module imported first runs first.
- `publishableKey` is **required** (the kill switch is per key). Without `url` and key, outside a
  browser, with `disabled: true`, or when the cached remote config says this key is killed, it
  does nothing. It never throws, and importing it has no side effect.
- It imports no React and no tracker code (a small separate, minified bundle: at most 8 KiB).
- Its `propagateHeadersTo` keeps working after the tracker mounts, even if you do not repeat it on
  the tracker: each request uses the newest install that allows its origin.
- The first page view keeps the session the early headers already used, even when your auth
  hook has not resolved the user yet on the first render.

## Options (`useNexusTracker` / `<NexusTracker/>`)

| Option | Default | Meaning |
|---|---|---|
| `url` | (required) | NEXUS_URL **without** `/api`. The ingest and config endpoints are derived from it. A full `…/api/v1/ingest/browser` URL is also accepted. |
| `publishableKey` | (required) | `nx_pk_…`. It travels in the request **body** (no custom header, so no CORS preflight). |
| `pathname` | (required, hook only) | The current path **including your base path**, without query or hash. |
| `routeTemplate` | (none; derived by `<NexusTracker/>`) | The route pattern including the base path, e.g. `/my-app/stores/:id`. Stamped on every event of the page view. Omit it when unsure. |
| `user` | (none) | `{ email }` of the signed-in user. It's only a **hint**: Nexus trusts the SSO cookie first. |
| `environment` | `dev` on localhost, else server default (`prod`) | `prod`, `staging` or `dev`. Keeps staging and local traffic out of the prod dashboards. |
| `release` | (none) | Your frontend build, e.g. `2026.11.18-a1b2c3d` (at most 64 chars; longer values are dropped). |
| `propagateHeaders` | `true` | Adds `X-Nexus-Session` / `X-Nexus-Page-View` to **same-origin** `fetch` and `XMLHttpRequest` (axios) calls so `@nexus/express` can link API requests to page views. Same-origin custom headers never trigger a CORS preflight. Headers you set yourself are never overwritten; a `Request` keeps its own referrer policy; the Nexus endpoints are never touched. Relative URLs are resolved like `fetch` does (against `<base href>`). `window.fetch` and the XHR prototype are patched once and restored when the last tracker unmounts (unless something wrapped them after us). **With the early install (`@nexus/react/early`) the patches stay for the page's lifetime** (pass-through when off); only the kill switch removes them. ⚠ **Redirects:** the check looks at the request's first URL only. A same-origin call that your server redirects to another origin (e.g. a `302` to a presigned S3 / Azure Blob download URL) keeps the headers, so the browser sends a CORS preflight to that target. If the target's CORS does not allow `X-Nexus-Session` / `X-Nexus-Page-View`, the call fails. Allow the headers there, or set `propagateHeaders: false`. |
| `propagateHeadersTo` | `[]` | Extra **exact** origins (e.g. `['https://api.example.com']`) that also get the headers. ⚠ That API's CORS config must list `X-Nexus-Session` and `X-Nexus-Page-View` in `allowedHeaders`, or the browser **blocks** the request. Never set remotely. |
| `remoteConfig` | `true` | Asks Nexus for module switches and the kill switch (see below). |
| `persistRetries` | `true` | Keeps failed batches in `localStorage` and replays them on the next page load. |
| `autoTools` | `true` | Records clicks on `[data-nexus-tool]` elements. |
| `disabled` | `false` | Turns the tracker off. |
| `basePath` | `''` (see above) | `<NexusTracker/>` only. |

## Tool and custom events

```tsx
// 1. Markup: recorded on click, no code needed.
<button data-nexus-tool="audits.export-csv" data-nexus-action="export" data-nexus-label="Export CSV">
  Export CSV
</button>

// 2. Code: for anything a click attribute can't express.
import { trackTool, trackEvent } from '@nexus/react'; // also exported from '@nexus/react/next'
trackTool('audits.export-csv', { action: 'export', value: rows, props: { format: 'csv' } });
trackEvent('report.generated', { value: 3 });
```

- Names must match `^[a-z0-9][a-z0-9_.:-]{0,63}$`, e.g. `audits.export-csv`. Invalid names are ignored.
- `action` is one of `click | open | submit | export | toggle | search | other`.
- `label` must be **static UI text** (at most 120 chars). The tracker never reads an element's text content.
- `props`: at most 10 keys matching `^[a-z][a-z0-9_]{0,39}$`, with strings (at most 128 chars), numbers or booleans as values. Invalid entries are dropped.
- **Never** send user-typed text, query strings, tokens or other PII.

## What it sends, and when

| Event | When |
|---|---|
| `page_view` | On the first path (`nav: "load"`, external `referrerHost` only), then on every path change (`nav: "route"`, `referrerPath` = previous in-app path). |
| `page_time` | Visible-time **deltas**: when the tab is hidden (`hidden`), every 5 s while visible (`idle`), and with `final: true` on route change or unmount (`route`) and tab close (`pagehide`). |
| `tool_use` | A `[data-nexus-tool]` click or `trackTool()`. |
| `custom` | `trackEvent()`. |

Events are batched: a batch goes out every 5 s, at 20 events, and right away on hidden/pagehide.
Each request holds at most 50 events and 60 KiB, as `text/plain`, with `environment`, `release`
and the route template when known.

- **In the page**, batches go one at a time with `fetch` + `keepalive`, using the browser's own
  `fetch` captured before any patch (a host interceptor that adds `Authorization` never sees them).
  A request with no answer after 15 s is aborted and retried like a network error. At most 10
  batches wait in memory; beyond that the oldest one goes to the retry queue (or is dropped and
  counted), so a dead collector never grows the page's memory.
- **On hidden / pagehide**, they go with `navigator.sendBeacon` (falling back to `fetch`).

The session id lives in `sessionStorage`. It rotates after 30 min of inactivity or when the
signed-in user changes (anonymous → signed in keeps the session). The device id lives in
`localStorage`. If storage is blocked, both fall back to memory.

## Retries

| Response | What happens |
|---|---|
| 2xx | Delivered. |
| 400, 413, 415, 403 `ORIGIN_NOT_ALLOWED` | Dropped (the same batch can never succeed). |
| 429, 5xx | Retried in the page with back-off (3 attempts), then **persisted**. |
| Network error / unreadable response | Retried with back-off; persisted once. |
| 401/403 with a kill code | The kill switch (below). |

Persisted batches live in `localStorage` (`nexus.retry:<key prefix>`) and are replayed on the next
page load with `client.replay: true`. They are stored **without** the user hint, keep their
original event ids and times (the server de-duplicates), and are bounded: 20 batches, 128 KiB per
key, 24 h, and dropped after 3 page loads without delivery. One tab replays at a time. If storage
is full or blocked, the batch is dropped and counted — there is no in-memory fallback. A batch
whose retry is still in flight when the tab closes is persisted too. On start the tracker also
removes expired queues and config caches of **other** keys (an old, rotated key) from
`localStorage`.

## Remote config and the kill switch

On start the tracker applies the cached config for its key synchronously, then (at most every
5 min) posts `{key, client}` to `…/api/v1/ingest/config` with the captured `fetch` and
`credentials: 'omit'`. Admins can switch off single modules (`page_view`, `page_time`,
`auto_tools`, `manual_tools`, `custom`, `header_propagation`, `retry_queue`) from the Apps page.
Remote config can only **disable**; it never turns anything on (not even propagation).

**Kill switch:** when the config or ingest endpoint answers 401/403 with `APP_DISABLED`,
`BROWSER_INGEST_DISABLED`, `INVALID_API_KEY`, `WRONG_KEY_TYPE` or `SECRET_KEY_EXPOSED`, the SDK
stops **in the current page**: queues are dropped, the persisted queue is purged, the next `fetch`
and XHR are no longer decorated, and `window.fetch` / the XHR prototype are restored if nothing
wrapped them after us. The next page load starts disabled from the cache. While killed, the
tracker re-checks every 15 min, also in an open tab; when the admin lifts the kill, the next valid
config answer turns capture back on **in the same page** (no reload needed). Network errors, 5xx
and 429 never change the state (capture fails open).

## Diagnostics: `getNexusStats()`

```ts
import { getNexusStats } from '@nexus/react'; // also from '@nexus/react/next'
getNexusStats();
// { queued, droppedOverflow, persisted, persistFailed, replayed, expired, droppedReplayCap,
//   configVersion, disabled }
```

Counters are local to the page (nothing is sent to Nexus). It never throws.

## Development (this repo)

```bash
npm run build -w @nexus/react      # tsup → dist (cjs + esm + d.ts) for index, next and early
npm run test -w @nexus/react       # vitest + jsdom
npm run typecheck -w @nexus/react
```
