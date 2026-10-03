# Browser contract

Your frontend sends **usage events** — page views, time on page, tool use and custom events — to:

```text
POST {{BROWSER_URL}}
Content-Type: text/plain        ← what navigator.sendBeacon sends; application/json also works
```

> **Reference hook coming.** The React tracker (`useNexusTracker` / `<NexusTracker/>` for Next.js) is
> on its way and will do everything in this chapter for you. Until then, follow the payload spec
> below — it is final for contract v{{CONTRACT_VERSION}}, so anything you build now keeps working.

## How it differs from the server flow

| | Browser endpoint |
|---|---|
| Key | the **publishable** key `nx_pk_…`, in the JSON body field `key` (no custom headers, so no CORS preflight) |
| Origin | the request's `Origin` must be one of your app's registered origins (`ORIGIN_NOT_ALLOWED` otherwise) |
| Paths | every event `path` must start with your app's base path (`PATH_OUTSIDE_APP` otherwise) |
| Identity | the SSO `access_token` cookie travels with the beacon (same site) and **we verify it ourselves** |
| Size | up to **{{BROWSER_MAX_EVENTS}} events** and **{{BROWSER_MAX_BODY_KB}} KiB** per request |
| Rate | {{RATE_BROWSER_PER_MIN}} requests per minute per session, and {{RATE_BROWSER_APP_PER_MIN}} per minute for the whole app |

A **secret** key sent here is refused with `403 SECRET_KEY_EXPOSED` and flagged for rotation.

## The batch (envelope)

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `key` | string | **yes** | Your publishable key `nx_pk_…`. |
| `sentAt` | string (ISO-8601) | **yes** | When this request was sent (`new Date().toISOString()`); re-stamp on retry. |
| `sessionId` | string (UUID) | **yes** | One per browser tab: keep it in `sessionStorage`; start a new one after 30 minutes without activity or when the signed-in user changes. |
| `anonymousId` | string (UUID) | no | One per device: keep it in `localStorage`. Lets us count returning anonymous visitors. |
| `user` | object | no | `{ "email": "…" }` — a **hint only** (stored as *claimed*, never counted as identified). The verified SSO cookie always wins. |
| `client` | object | no | `{ "sdk": "my-tracker", "version": "1.0.0", "tz": "Asia/Kolkata", "lang": "en-IN" }` — sdk ≤ 64, version ≤ 32, tz ≤ 64, lang ≤ 16 chars. |
| `events` | array | **yes** | 1 – {{BROWSER_MAX_EVENTS}} events (below). |

## Fields every event has

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `type` | string | **yes** | `page_view`, `page_time`, `tool_use` or `custom`. |
| `eventId` | string (UUID) | **yes** | `crypto.randomUUID()`, created once, reused on retry. |
| `occurredAt` | string (ISO-8601) | **yes** | When it happened. Same time window as server events. |
| `seq` | integer ≥ 0 | **yes** | Increases by one per event within a session. Orders a journey when timestamps tie. |
| `path` | string | **yes** | The page path **including your base path**, **without query string or hash**: `/ebo-audit/audits`. ≤ 2048 chars. (Next.js `usePathname()` omits `basePath` — add it.) |
| `routeTemplate` | string | no | The route pattern, e.g. `/ebo-audit/audits/:id`. ≤ 256 chars. |

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

The reference hook listens for clicks on `[data-nexus-tool]` (and offers `trackTool()` for anything
else). If you build your own tracker, do the same so your markup is ready.

### `custom` — anything else worth counting

Same as `tool_use`, but with `name` (same pattern) instead of `tool`/`action`:
`{ "type": "custom", "name": "report.generated", "value": 3 }`.

## Full example

{{example:browser}}

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
