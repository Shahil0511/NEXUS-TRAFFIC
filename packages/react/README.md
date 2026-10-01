# @nexus/react

The reference **browser tracker** for Data Nexus Traffic. Add it once to your app's root and you
get page views, visible time on page, tool usage and custom events, all sent in the
[browser contract](https://nexus.libas.in/traffic/api/docs/) format.

- React 18 or 19. Next.js App Router via the `@nexus/react/next` entry.
- **No runtime dependencies.** The contract constants are bundled in, and zod is never included.
- **It never throws into your app.** If storage is blocked or the network fails, events are dropped quietly.
- **It does nothing without config.** If `url` or `publishableKey` is missing (e.g. local dev), on the server, or when `disabled` is set, the tracker stays off.

## Install (vendored tarball)

Download `nexus-react-1.0.0.tgz` from the integration guide, commit it under `vendor/`, then:

```jsonc
// package.json
"dependencies": {
  "@nexus/react": "file:vendor/nexus-react-1.0.0.tgz"
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
  });
  return null;
}
```

Render `<NexusTracking/>` once inside your router. The full file is `docs/snippets/vite-react-tracker.tsx`.

## Options (`useNexusTracker` / `<NexusTracker/>`)

| Option | Default | Meaning |
|---|---|---|
| `url` | (required) | NEXUS_URL **without** `/api`. The ingest endpoint is derived from it. A full `…/api/v1/ingest/browser` URL is also accepted. |
| `publishableKey` | (required) | `nx_pk_…`. It travels in the request **body** (no custom header, so no CORS preflight). |
| `pathname` | (required, hook only) | The current path **including your base path**, without query or hash. |
| `user` | (none) | `{ email }` of the signed-in user. It's only a **hint**: Nexus trusts the SSO cookie first. |
| `autoTools` | `true` | Records clicks on `[data-nexus-tool]` elements. |
| `propagateHeaders` | `false` | Adds `X-Nexus-Session` / `X-Nexus-Page-View` to **same-origin** `fetch` calls so `@nexus/express` can link API requests to page views. `window.fetch` is patched once and restored when the last tracker unmounts. Other origins and the ingest URL are never touched. |
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
Each request holds at most 50 events and 60 KiB. It is sent with `navigator.sendBeacon` as
`text/plain`, falling back to `fetch` with `keepalive`. Browser batches are not retried.

The session id lives in `sessionStorage`. It rotates after 30 min of inactivity or when the
signed-in user changes (anonymous → signed in keeps the session). The device id lives in
`localStorage`. If storage is blocked, both fall back to memory.

## Development (this repo)

```bash
npm run build -w @nexus/react      # tsup → dist (cjs + esm + d.ts)
npm run test -w @nexus/react       # vitest + jsdom
npm run typecheck -w @nexus/react
```
