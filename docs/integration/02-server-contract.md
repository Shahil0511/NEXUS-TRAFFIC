# Server contract

Your backend sends **one event per API request** it handled, in batches, to:

```text
POST {{SERVER_URL}}
Content-Type: application/json
X-Nexus-Key: nx_sk_…            ← your SECRET key
```

- Up to **{{SERVER_MAX_EVENTS}} events** and **{{SERVER_MAX_BODY_KB}} KiB** per request.
- The call is **synchronous**: a `202` means the events are stored. Answers are explained in
  [chapter 4](04-responses-retries.md).
- `?dryRun=1` validates and enriches the batch but **stores nothing** — use it while integrating.

## Minimal example

```bash
curl -sS -X POST '{{SERVER_URL}}' \
  -H 'Content-Type: application/json' \
  -H "X-Nexus-Key: $NEXUS_SECRET_KEY" \
  --data-binary @- <<'JSON'
{
  "sentAt": "2026-10-01T09:30:05.120+05:30",
  "events": [
    {
      "eventId": "0b8f6c1e-5a2d-4c4f-9a51-2f0f3d7f6a11",
      "occurredAt": "2026-10-01T09:30:04.870+05:30",
      "method": "GET",
      "path": "/ebo-sales/api/v1/stores/1042",
      "routeTemplate": "/ebo-sales/api/v1/stores/:id",
      "status": 200,
      "durationMs": 41.7
    }
  ]
}
JSON
```

Answer:

```json
{ "accepted": 1, "duplicates": 0, "rejected": [], "warnings": [] }
```

## The batch (envelope)

| Field | Type | Required | Rules |
|---|---|---|---|
| `sentAt` | string (ISO-8601) | **yes** | When *this attempt* was sent. **Re-stamp it on every retry.** Used to measure your clock skew. |
| `sdk` | object | no | `{ "name": "…", "version": "…" }` — name ≤ 64 chars, version ≤ 32. Helps us help you. |
| `events` | array | **yes** | 1 – {{SERVER_MAX_EVENTS}} events (below). |

Each event is validated **on its own**: one bad event never fails the batch. Problems are listed in
the answer's `rejected[]` (with the event's index), the other events are stored.

## The event

| Field | Type | Required | Rules and meaning |
|---|---|---|---|
| `eventId` | string (UUID) | **yes** | Created **once** when you record the request (`crypto.randomUUID()`, `uuid.uuid4()`). Reused unchanged on every retry — the idempotency key. |
| `occurredAt` | string (ISO-8601) | **yes** | When the request **started**. `Z` or an offset (`+05:30`) is required. Must be within the last {{MAX_BACKDATE_DAYS}} days and at most {{MAX_FUTURE_MINUTES}} minutes ahead of our clock, else the event is rejected (`EVENT_TIME_OUT_OF_RANGE`). Stored exactly as sent. |
| `method` | string | **yes** | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS` (any case). |
| `path` | string | **yes** | The **public** path as the user's browser saw it, **including your base path**, **without the query string**: `/ebo-sales/api/v1/stores/1042`. Must start with `/`, ≤ 2048 chars (we keep the first 512). A query string, if sent, is removed. |
| `status` | integer | **yes** | Final HTTP status, 100 – 599. Use `499` if the client disconnected before the response finished. |
| `durationMs` | number | **yes** | Request start → response finished, in milliseconds (fractions allowed), 0 – 3 600 000. Measure with a monotonic clock (`process.hrtime`, `time.perf_counter`). |
| `routeTemplate` | string | no, **strongly recommended** | The route pattern, with your base path: `/ebo-sales/api/v1/stores/:id`. Starts with `/`, ≤ 256 chars. Without it we guess (see below). |
| `kind` | string | no | `http` (default) or `stream` — SSE, file downloads, CSV exports. Streams are kept out of latency percentiles so they do not distort p95. |
| `ip` | string | no | The **end user's** IP, resolved through your trusted proxies — [chapter 6](06-client-ip.md). ≤ 64 chars. An unparseable value is dropped with a `FIELD_DROPPED` warning. |
| `userEmail` | string | no | The **verified** signed-in user — [chapter 7](07-user-email.md). ≤ 254 chars. Omit for anonymous requests. An implausible value is dropped with a warning. |
| `requestId` | string | no | Your correlation id (e.g. the `X-Request-ID` you log). ≤ 128 chars. |
| `userAgent` | string | no | The `User-Agent` request header. ≤ 4096 chars (we keep 512). |
| `requestBytes` | integer | no | Request body size (`Content-Length`), ≥ 0. |
| `responseBytes` | integer | no | Response body size, ≥ 0. |
| `errorCode` | string | no | Your app's error **code**, e.g. `VALIDATION_ERROR`. Must match `^[A-Z0-9_]{1,64}$`. **Never an error message.** |
| `release` | string | no | Your app version or git sha, ≤ 64 chars. Lets the dashboard compare releases. |
| `sessionId` | string (UUID) | no | Copy of the `X-Nexus-Session` request header, if the frontend tracker sends it. |
| `pageViewId` | string (UUID) | no | Copy of the `X-Nexus-Page-View` request header, if present. |

Anything else you send is **ignored** — do not send messages, bodies, headers or titles.

### Field notes

- **Timestamps** look like `2026-10-01T04:00:12.345Z` or `2026-10-01T09:30:12.345+05:30`. Seconds
  are required, milliseconds recommended. `new Date().toISOString()` in JavaScript and
  `datetime.now(timezone.utc).isoformat()` in Python both work.
- **UUIDs** must be real RFC 4122/9562 UUIDs (version digit 1–8). Random v4 is perfect.
- **`eventId` + `occurredAt` together** identify an event. Resending the same pair is counted in
  `duplicates` and stored once. So keep the event object as it was first built and resend it as-is.
- **Without `routeTemplate`** we normalise the path ourselves: UUIDs → `:id`, numbers with 6+ digits →
  `:num`, emails → `:email`, long hex/base64 tokens → `:token`. Short ids such as `/stores/1042` stay
  as they are and every store becomes its own "endpoint". Send `routeTemplate` and this never happens.
- **Health checks, static assets and `OPTIONS` preflights** are noise — skip them (the snippets do).

## Full example

Both events below are valid; the second one is a failure with an error code.

{{example:server}}

## Batching — how often to send

| Rule | Value |
|---|---|
| Flush when the queue reaches | {{FLUSH_EVENTS}} events |
| …or at the latest every | {{FLUSH_SECONDS}} seconds |
| Events per request | at most {{SERVER_MAX_EVENTS}} |
| Request timeout | 5 seconds |
| Queue limit in memory | 5 000 events — drop the oldest beyond that |
| On shutdown | flush once (within your existing shutdown timeout) |

Sending happens on a timer, **never inside the user's request**. Retry rules are in
[chapter 4](04-responses-retries.md).

## Dry run

```bash
curl -sS -o server-batch.json '{{DOCS_URL}}files/examples/server-batch.json'
curl -sS -X POST '{{SERVER_URL}}?dryRun=1' -H 'Content-Type: application/json' \
  -H "X-Nexus-Key: $NEXUS_SECRET_KEY" --data-binary @server-batch.json
```

The answer has the same shape plus `"dryRun": true`; nothing is stored. Use it in CI or while
integrating to see `rejected[]` and `warnings[]` for your real payloads.

> The example file has **fixed** timestamps, so a week after they were written its events come back
> as `rejected` with `EVENT_TIME_OUT_OF_RANGE`. That is the time window working — use current
> timestamps (as `curl.sh` in [chapter 8](08-recipes.md) does) for a clean result.
