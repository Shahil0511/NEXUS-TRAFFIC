# Browser contract

Your frontend sends **usage events** — page views, time on page, tool use and custom events — to:

```text
POST {{BROWSER_URL}}
Content-Type: text/plain        ← what navigator.sendBeacon sends; application/json also works
```

> **Use the reference tracker.** `@nexus/react` ({{REACT_SDK_VERSION}}: `<NexusTracker/>` for Next.js,
> `useNexusTracker()` for Vite / React Router) does everything in this chapter for you — batching,
> time on page, tool clicks, route templates, header propagation, retries and the kill switch. Setup
> is in [chapter 8](08-recipes.md). The payload spec below is for teams that build their own tracker.

## How it differs from the server flow

| | Browser endpoint |
|---|---|
| Key | the **publishable** key `nx_pk_…`, in the JSON body field `key` (no custom headers, so no CORS preflight) |
| Origin | the request's `Origin` must be one of your app's registered origins (`ORIGIN_NOT_ALLOWED` otherwise) |
| Paths | every event `path` must start with your app's base path (`PATH_OUTSIDE_APP` otherwise) |
| Identity | the SSO `access_token` cookie travels with the beacon and **we verify it ourselves** (see "Who the user is" below) |
| Size | up to **{{BROWSER_MAX_EVENTS}} events** and **{{BROWSER_MAX_BODY_KB}} KiB** per request |
| Rate | {{RATE_BROWSER_PER_MIN}} requests per minute per session, and {{RATE_BROWSER_APP_PER_MIN}} per minute for the whole app |

A **secret** key sent here is refused with `403 SECRET_KEY_EXPOSED` and flagged for rotation.

## The batch (envelope)

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `key` | string | **yes** | Your publishable key `nx_pk_…`. |
| `sentAt` | string (ISO-8601) | **yes** | When this request was sent (`new Date().toISOString()`); re-stamp on retry. |
| `sessionId` | string (UUID) | **yes** | One per browser tab: keep it in `sessionStorage`; start a new one after 30 minutes without activity or when the signed-in user changes. |
| `anonymousId` | string (UUID) | no | One per device: keep it in `localStorage`. Lets us count new and returning devices. |
| `user` | object | no | `{ "email": "…" }` — a **hint only** (stored as *claimed*, never counted as identified). The verified SSO cookie always wins. |
| `environment` | string | no | {{ENVIRONMENT_VALUES}}. Omitted → `{{DEFAULT_ENVIRONMENT}}`; an unknown value is ignored with a `FIELD_DROPPED` warning. A page served from `localhost`, `*.localhost`, `*.local`, `127.x.x.x` or `[::1]` is **always** stored as `dev`, whatever it claims. |
| `release` | string | no | Your frontend build, e.g. `2026.11.18-a1b2c3d`. ≤ 64 chars. Lets the dashboard compare releases. |
| `client` | object | no | `{ "sdk": "my-tracker", "version": "1.1.0", "tz": "Asia/Kolkata", "lang": "en-IN", "replay": true }` — sdk ≤ 64, version ≤ 32, tz ≤ 64 (an IANA zone name), lang ≤ 16 (a language tag such as `en-IN`). A `tz` / `lang` that does not look like one is dropped with a warning. `replay: true` marks a batch resent on a **later page load** (see "Retries" below). |
| `events` | array | **yes** | 1 – {{BROWSER_MAX_EVENTS}} events (below). |

## Fields every event has

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `type` | string | **yes** | `page_view`, `page_time`, `tool_use` or `custom`. |
| `eventId` | string (UUID) | **yes** | `crypto.randomUUID()`, created once, reused on retry. |
| `occurredAt` | string (ISO-8601) | **yes** | When it happened. Same time window as server events. |
| `seq` | integer ≥ 0 | **yes** | Increases by one per event within a session. Orders a journey when timestamps tie. |
| `path` | string | **yes** | The page path **including your base path**, **without query string or hash**: `/ebo-audit/audits`. ≤ 2048 chars. (Next.js `usePathname()` omits `basePath` — add it.) |
| `routeTemplate` | string | no, **recommended** | The route pattern **including your base path**, e.g. `/ebo-audit/audits/:id`. ≤ 256 chars. See below. |

### Route templates

The dashboard groups page views **by route**: `/ebo-audit/audits/17` and `/ebo-audit/audits/42` are
one page, "`/ebo-audit/audits/:id`". Send the template and the grouping is exact; without it we guess
from the path (UUIDs, long numbers, emails and tokens become placeholders, short ids stay as they
are).

| Syntax | Meaning | Example |
|---|---|---|
| `:name` | one path segment | `/my-app/stores/:id` |
| `:name*` | catch-all, **last** segment only: the rest of the path (zero or more segments) | `/my-app/docs/:slug*` (Next `[...slug]` / `[[...slug]]`) |

- **Next.js** — `<NexusTracker/>` builds it from `usePathname()` + `useParams()`. When a param value
  is missing, or appears twice in the path, it sends no template (we guess, as before). Pass
  `routeTemplate` to override.
- **React Router** — derive it from `matchRoutes(routes, location)` (the Vite snippet in
  [chapter 8](08-recipes.md) does this) and pass it to `useNexusTracker({ routeTemplate })`.
- **We check it.** A template is kept only if it is inside your base path, has as many segments as
  the path (a trailing `:name*` may match more), and every fixed segment equals the path's
  (ignoring case). Otherwise it is dropped with a `FIELD_DROPPED` warning (field `routeTemplate`)
  and we guess — a wrong template can never merge two different pages.

## The four event types

### `page_view` — a page was opened

| Field | Type | Required | Rules |
|---|---|---|---|
| `nav` | string | **yes** | `load` (full document load) or `route` (client-side navigation). |
| `referrerPath` | string | no | The previous in-app path (no query). |
| `referrerHost` | string | no | The external referrer's **host only**, e.g. `mail.google.com` — never a full URL. ≤ 253 chars. |

### `page_time` — time spent on a page

| Field | Type | Required | Rules |
|---|---|---|---|
| `pageViewId` | string (UUID) | **yes** | The `eventId` of the `page_view` this time belongs to. |
| `visibleMs` | integer | **yes** | Milliseconds the page was **visible** since the previous `page_time` of this view — a **delta**, 0 – 86 400 000. |
| `final` | boolean | **yes** | `true` when the view ended (route change, tab closed). |
| `reason` | string | **yes** | `hidden` (tab hidden), `route` (navigated away), `pagehide` (tab closed / bfcache), `idle`. |

**How time on page is computed.** We add up all `visibleMs` deltas of one `pageViewId`. So:

1. On `page_view`, start a visible-time counter (only while `document.visibilityState === 'visible'`).
2. When the tab becomes hidden → send `page_time` with the time since the last send,
   `reason: "hidden"`, `final: false`, and reset the counter. Resume counting when visible again.
3. On route change → send the remainder with `reason: "route"`, `final: true`.
4. On `pagehide` → send the remainder with `reason: "pagehide"`, `final: true` (use `sendBeacon`, the
   page is going away).

Deltas make lost beacons harmless: a missing one loses a few seconds, never double-counts.

### `tool_use` — a feature of your UI was used

| Field | Type | Required | Rules |
|---|---|---|---|
| `tool` | string | **yes** | A stable, lower-case, dotted id: `audits.export-csv`. Pattern `^[a-z0-9][a-z0-9_.:-]{0,63}$`. |
| `action` | string | no | `click`, `open`, `submit`, `export`, `toggle`, `search` or `other`. |
| `label` | string | no | A **static** UI label such as `Export CSV` (≤ 120 chars). **Never text the user typed.** |
| `value` | number | no | A number that matters for the tool (e.g. rows exported). |
| `props` | object | no | ≤ 10 entries; keys match `^[a-z][a-z0-9_]{0,39}$`; values are strings ≤ 128 chars, numbers or booleans. No nesting. |

**Auto-capture convention.** Mark the elements you care about and the tracker records their clicks:

```html
<button data-nexus-tool="audits.export-csv">Export CSV</button>
```

The reference tracker listens for clicks on `[data-nexus-tool]` (and offers `trackTool()` for
anything else). If you build your own tracker, do the same so your markup is ready.

### `custom` — anything else worth counting

Same as `tool_use`, but with `name` (same pattern) instead of `tool`/`action`:
`{ "type": "custom", "name": "report.generated", "value": 3 }`.

## Full example

{{example:browser}}

## Who the user is (the SSO cookie)

For apps behind the company portal you do not send the user at all: the portal's `access_token`
cookie travels with the beacon and **we verify it** (identity `sso_cookie`). For that the browser must
actually send the cookie to `{{BROWSER_URL}}`:

- the cookie's **`Path`** must cover the collector — `Path=/` (a cookie scoped to `/your-app` never
  reaches `/traffic/api/…`);
- its **`Domain`** must cover the collector's host — automatic for apps on `nexus.libas.in`;
- on a **different site** the cookie needs `SameSite=None; Secure`, and the beacon must be sent with
  credentials (the reference tracker does). Most portal cookies are `SameSite=Lax`, so a cross-site
  page stays anonymous in the browser data — send `userEmail` from your **backend** instead
  ([chapter 7](07-user-email.md)).

Every beacon's cookie outcome (`ok`, `no-cookie`, `expired`, `bad-signature`, …) and whether it came
from the same origin as the collector is counted, and shown on the Integration page as "SSO cookie
(browser identity)" — the first place to look when browser events stay anonymous. Batches marked
`client.replay: true` never use the cookie (it may belong to a later user) and are stored anonymous.

## Linking API calls to page views (header propagation)

When the tracker is on, it adds two headers to your app's **own** API calls:

| Header | Value |
|---|---|
| `X-Nexus-Session` | the current `sessionId` |
| `X-Nexus-Page-View` | the `eventId` of the current page view |

Your backend middleware copies them into the server event (`sessionId`, `pageViewId`), so the
dashboard can show which API calls a page made and how slow they were for that user.

- **On by default, same-origin only** (`propagateHeaders: true`). Same-origin custom headers never
  trigger a CORS preflight. Headers you set yourself are never overwritten, and calls to the Nexus
  endpoints are never touched.
- **`fetch` and `XMLHttpRequest`** (so axios) are both covered. The tracker wraps them once; every
  call checks, live, whether propagation is still allowed (not killed, not switched off remotely).
- **Another origin** (an API on its own host) gets the headers only when you list it exactly:
  `propagateHeadersTo: ['https://api.example.com']`. **That API's CORS config must then allow
  `X-Nexus-Session` and `X-Nexus-Page-View`** (`Access-Control-Allow-Headers`), or the browser
  **blocks** the call. This list is never set remotely. The list given to the early install keeps
  working after the tracker mounts (each request uses the newest install that allows its origin).
- **Redirects.** The same-origin check looks at the request's **first** URL only. A same-origin call
  that your server answers with a redirect to another origin (for example a `302` to a presigned S3
  or Azure Blob download URL) keeps the two headers, so the browser sends a CORS preflight to the
  redirect target. If that target's CORS does not allow `X-Nexus-Session` / `X-Nexus-Page-View`, the
  call fails. Allow the headers there, or set `propagateHeaders: false`.
- **First requests.** The tracker mounts after hydration, so calls made earlier (a data client
  created at module load, the first `openapi-fetch` / axios request) would go out without headers.
  Install the headers **before** your app with `@nexus/react/early`:
  - Next.js ≥ 15.3 → `src/instrumentation-client.ts` ([next-instrumentation-client.ts](files/snippets/next-instrumentation-client.ts));
  - Vite / CRA → `src/nexus-early.ts` ([vite-nexus-early.ts](files/snippets/vite-nexus-early.ts)), imported as the
    **first** line of `main.tsx`: `import './nexus-early';`. ES imports are hoisted — a call written in
    `main.tsx`'s body runs only after every imported module (your API client included), which is
    too late. A module imported first runs first.

  `installNexusEarly({ url, publishableKey })` needs the publishable key (the kill switch is per
  key); the tracker later adopts the same session and the pre-allocated page-view id — also when
  your auth hook resolves the user only after the first render.

How many of your API calls carry the headers is shown as **Linked API calls** on the Integration
page — counted over calls that *could* carry them: `http` calls from desktop, mobile or tablet
browsers (server-side rendering, server-to-server calls, bots and downloads never can).

## Sending

```js
const url = `${process.env.NEXT_PUBLIC_NEXUS_URL}/api/v1/ingest/browser`;

function sendBatch(batch) {
  const body = JSON.stringify({ ...batch, sentAt: new Date().toISOString() });
  // text/plain = a "simple" request: no CORS preflight; cookies are sent (same site).
  const queued = navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }));
  if (!queued) {
    fetch(url, { method: 'POST', body, keepalive: true, credentials: 'include',
                 headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  }
}
```

- Flush every 5 seconds or 20 events, and immediately on `visibilitychange → hidden` and `pagehide`.
- Wrap every `sessionStorage` / `localStorage` access in `try/catch` (private mode, blocked storage).
- Never let the tracker throw: a failed beacon is simply lost.

The reference tracker sends in-page batches with `fetch` + `keepalive` (one at a time, so the status
is readable) and uses `sendBeacon` only when the page is hidden or closing. It uses the browser's own
`fetch`, captured before any wrapper — a host interceptor that adds `Authorization` never sees our
requests. A request with no answer after {{SDK_INGEST_TIMEOUT}} seconds is aborted and retried like a
network error, and at most {{SDK_MAX_PENDING_BATCHES}} batches wait in memory (the oldest one then
goes to the persistent queue), so an unreachable collector never grows the page's memory.

## Retries (the persistent queue)

| Response | The reference tracker |
|---|---|
| `2xx` | delivered |
| `400`, `413`, `415`, `403 ORIGIN_NOT_ALLOWED` | dropped — the same batch can never succeed |
| `401` / `403` with a kill code ({{SDK_KILL_CODES}}) | stops capturing — see the kill switch below |
| `429`, `5xx` | retried in the page with back-off (3 attempts), then **persisted** |
| network error / unreadable response | retried with back-off, persisted at most once |

Persisted batches are kept in `localStorage` per publishable key and **replayed on the next page
load** with `client.replay: true`. They keep their original `eventId`, `occurredAt`, `sessionId` and
`seq` (we de-duplicate), and are stored **without** the `user` hint. Bounds: {{SDK_RETRY_MAX_BATCHES}}
batches and {{SDK_RETRY_MAX_KB}} KiB per key, at most {{SDK_RETRY_QUEUE_TTL}} hours old (by the
oldest event), and a batch is dropped after {{SDK_RETRY_MAX_REPLAYS}} page loads without delivery, so
a bad batch can never loop. One tab replays at a time; if storage is full or blocked the batch is
dropped (and counted in `getNexusStats()`), never kept in memory. A batch whose retry is still in
flight when the tab closes is persisted too. Expired queues of **other** keys (a rotated key) are
removed on start. Switch it off with `persistRetries: false`.

## Remote config and the kill switch

Nexus admins can change what the tracker captures **without a redeploy**, on the dashboard's Apps
page:

- **Module switches** — turn off single parts of the tracker: {{SDK_MODULES}}. Remote config can only
  **disable**; it never turns anything on (not even header propagation). Needs SDK ≥
  {{SDK_MODULE_SWITCH_MIN_VERSION}}.
- **Kill switch (browser capture)** — the app's *browser ingest* flag. When it is off, every browser
  batch is refused with `403 BROWSER_INGEST_DISABLED`, for **every** SDK version (older trackers keep
  sending and keep being refused).

The tracker asks for its config at most every {{SDK_CONFIG_MAX_AGE}} minutes, in the background:

```text
POST {{CONFIG_URL}}
Content-Type: text/plain
{"key":"nx_pk_…","client":{"sdk":"@nexus/react","version":"{{REACT_SDK_VERSION}}"}}
```

```json
{ "contract": 1, "version": 3, "enabled": true, "disabledModules": ["auto_tools"], "maxAgeMs": 300000 }
```

- The key travels in the **body** (`text/plain`, a simple request: no preflight; never in a URL or
  an access log), with `credentials: 'omit'`. The answer is `Cache-Control: no-store`.
- `version` only goes up; the tracker ignores an older one. `enabled` is reserved (always `true` on a
  200).
- A `401` / `403` with a kill code means **stop**: the tracker drops its queues, purges the persisted
  queue, stops decorating `fetch` / XHR **in the current page**, and restores them when nothing
  wrapped them after it. The next page load starts disabled (from the cache). While killed, the
  tracker asks again every {{SDK_CONFIG_RECHECK}} minutes — also in a tab that stays open — and a
  valid `200` turns capture back on **in the same page**.
- A network error, `429` or `5xx` changes nothing: **capture fails open** with the last known config
  (a cached config is trusted for {{SDK_CONFIG_MAX_STALE}} hours, then the defaults apply).
- **Cross-origin collectors.** Error responses of the browser and config endpoints carry
  `Access-Control-Allow-Origin` for every origin that is registered for **some** app — also an app
  that is killed or disabled — *before* the key is checked. So a tracker on another origin can read
  the `403` and its code — without that, a refused request looks like a network error and the kill
  switch would never trip. Success still requires your app's own origin list.

Building your own tracker? Honour the kill codes above and treat everything else as "keep going".
