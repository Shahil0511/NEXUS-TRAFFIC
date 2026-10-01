# Responses and retries

## The success answer: `202 Accepted`

```json
{
  "accepted": 1,
  "duplicates": 1,
  "rejected": [
    { "index": 2, "code": "EVENT_TIME_OUT_OF_RANGE", "message": "occurredAt is older than 7 days" }
  ],
  "warnings": [
    { "index": 0, "code": "FIELD_DROPPED", "field": "ip" }
  ]
}
```

| Field | Meaning |
|---|---|
| `accepted` | events stored now |
| `duplicates` | events we already had (same `eventId` + `occurredAt`) — a retry that worked before |
| `rejected[]` | events refused: `index` in your `events` array, a `code`, a human `message` |
| `warnings[]` | events stored, but one `field` was dropped or truncated |
| `dryRun` | `true` when you called with `?dryRun=1` (nothing stored) |

**Never retry a 202**, even when `rejected[]` is not empty: those events will fail the same way.
Log the codes and fix the sender.

### Per-event codes

| Code | In | Meaning | Fix |
|---|---|---|---|
| `INVALID_EVENT` | `rejected` | the event does not match the contract — the message names the field | fix the field (chapter 2/3) |
| `EVENT_TIME_OUT_OF_RANGE` | `rejected` | `occurredAt` older than {{MAX_BACKDATE_DAYS}} days or > {{MAX_FUTURE_MINUTES}} min in the future | fix the server clock (NTP); do not resend week-old queues |
| `PATH_OUTSIDE_APP` | `rejected` | browser event path is not under your base path | include the base path; check the registered base path |
| `DB_CONSTRAINT` | `rejected` | a value passed validation but the database refused it | tell us — this is our bug |
| `FIELD_DROPPED` | `warnings` | a field was invalid and removed (e.g. an unparseable `ip`, an implausible `userEmail`) | fix that field |
| `FIELD_TRUNCATED` | `warnings` | a field was too long and shortened (e.g. `path` > 512 chars) | usually fine; check you strip query strings |

## Errors: everything that is not 202

Every error has the same JSON body:

```json
{ "error": { "code": "INVALID_API_KEY", "message": "Unknown or inactive API key", "requestId": "9f2c…" } }
```

Branch on `code` (stable), not on `message` (may change). Quote `requestId` when you contact us.

| Status | Codes | What happened | What your sender does |
|---|---|---|---|
| `400` | `INVALID_ENVELOPE`, `VALIDATION_ERROR`, `BAD_REQUEST` | the batch itself is malformed (bad JSON, no `events`, > {{SERVER_MAX_EVENTS}} events…) | **drop** the batch, log once, fix the code |
| `401` | `MISSING_API_KEY`, `INVALID_API_KEY` | no key, unknown key, expired or revoked key | **pause 5 minutes**, keep the events, alert a human |
| `403` | `WRONG_KEY_TYPE`, `SECRET_KEY_EXPOSED`, `ORIGIN_NOT_ALLOWED`, `APP_DISABLED`, `BROWSER_INGEST_DISABLED` | the key is real but not allowed here | **pause 5 minutes**, alert a human |
| `413` | `PAYLOAD_TOO_LARGE` | body over {{SERVER_MAX_BODY_KB}} KiB (server) / {{BROWSER_MAX_BODY_KB}} KiB (browser) | **split the batch in half** and send both halves |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | wrong `Content-Type` (server needs `application/json`) | **drop**, fix the code |
| `429` | `RATE_LIMITED` | too many requests for this key / session | wait **`Retry-After`** seconds, resend the same events |
| `503` | `INGEST_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | database busy or restarting | wait **`Retry-After`** seconds, resend the same events |
| other `5xx`, timeout, network error | — | something broke on the way | **back off 1 s, 2 s, 4 s** — at most 3 attempts, then drop |
| `3xx`, or an HTML page | — | **a proxy or SSO login page intercepted the call** — our API never redirects ingest and never answers it with HTML | drop, alert a human — see [chapter 11](11-troubleshooting.md) |

The difference between 401 and 403 matters when debugging: **401 = we do not know this key**,
**403 = we know it, but it may not do this** (wrong kind, wrong origin, app disabled).

## The retry algorithm

```text
send(batch):
  for attempt in 1..3:
    batch.sentAt = now()                      # re-stamp EVERY attempt; events stay unchanged
    response = POST batch (timeout 5 s, do not follow redirects)
    case response.status:
      202            → done                   # never retry, even with rejected[]
      3xx or HTML    → drop, log "proxy is intercepting"
      400, 415       → drop, log
      401, 403       → pause sending for 5 minutes, keep the events queued
      413            → split in half, send(each half)
      429, 503       → sleep(Retry-After or 5 s, max 60 s); continue
      5xx / network  → sleep(1 s, 2 s, 4 s); continue
  drop, log "gave up after 3 attempts"
```

## Idempotency — why resending is safe

- You create `eventId` **once**, when you record the request, and keep the whole event object.
- If a send times out you do not know whether it was stored. Resend the same events: the ones we
  already have come back in `duplicates`, nothing is stored twice.
- Only `sentAt` changes between attempts. **Never** regenerate `eventId` or `occurredAt` on retry —
  a new `occurredAt` makes it a different event.

## Limits at a glance

| Limit | Server | Browser |
|---|---|---|
| Events per request | {{SERVER_MAX_EVENTS}} | {{BROWSER_MAX_EVENTS}} |
| Body size | {{SERVER_MAX_BODY_KB}} KiB | {{BROWSER_MAX_BODY_KB}} KiB |
| Rate | {{RATE_SERVER_PER_MIN}} requests / minute / key | {{RATE_BROWSER_PER_MIN}} requests / minute / session |
| Event time window | {{MAX_BACKDATE_DAYS}} days back, {{MAX_FUTURE_MINUTES}} minutes ahead | same |
| Failed key checks | {{RATE_IP_FAILURES_PER_MIN}} / minute / IP, then `429` | same |
