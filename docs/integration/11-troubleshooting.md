# Troubleshooting

Start with the HTTP status and the `error.code`; quote the `requestId` when you contact
{{DOCS_CONTACT}}.

## The call does not reach us

| Symptom | Cause | Fix |
|---|---|---|
| `301`/`302`/`307` or an **HTML page** (often a login page) | a proxy or SSO layer intercepts the request — the gateway's `auth_request`, a corporate egress proxy, or a wrong URL that lands on a web app | call exactly `{{SERVER_URL}}`; do not follow redirects; ask your platform team to exempt `/traffic/api/` from SSO. Our API **never** answers ingest with a redirect or HTML. |
| `404` with an HTML body | the path is wrong (missing `/api`, or `/traffic` twice) | `NEXUS_URL` is `{{PUBLIC_URL}}`; the code appends `/api/v1/ingest/server` |
| timeout / `ECONNREFUSED` / DNS error from a container | the container cannot reach `nexus.libas.in` (hairpin) | test with the curl in [chapter 9](09-environments.md); use the `nexus-ingest` network fallback |
| TLS error | outdated CA bundle in a slim image | install `ca-certificates` in your image |

## Key and permission errors

| Status | Code | Meaning | Fix |
|---|---|---|---|
| `401` | `MISSING_API_KEY` | no `X-Nexus-Key` header (server) or no `key` field (browser) | check the variable is set in **this** environment and the header name |
| `401` | `INVALID_API_KEY` | unknown, expired or revoked key | copy errors (whitespace, quotes); ask for a new key if it was rotated |
| `403` | `WRONG_KEY_TYPE` | a publishable key on the server endpoint | the backend needs the `nx_sk_` key |
| `403` | `SECRET_KEY_EXPOSED` | a secret key was sent to the browser endpoint | treat the key as leaked: get a new one, rotate, use the `nx_pk_` key in the browser |
| `403` | `ORIGIN_NOT_ALLOWED` | the page's `Origin` is not registered for your app | ask us to add the origin (scheme + host + port) |
| `403` | `APP_DISABLED` | the app is switched off on our side | contact us |
| `403` | `BROWSER_INGEST_DISABLED` | browser tracking is off for this app | contact us |

**401 vs 403:** 401 = we do not recognise the key; 403 = we recognise it, but it is not allowed to do
this.

## Batch and event problems

| Symptom | Cause | Fix |
|---|---|---|
| `400 INVALID_ENVELOPE` | not JSON, `events` missing/empty, more than {{SERVER_MAX_EVENTS}} events | log the body shape once (not the content); batch ≤ {{SERVER_MAX_EVENTS}} |
| `413 PAYLOAD_TOO_LARGE` | body > {{SERVER_MAX_BODY_KB}} KiB — usually huge user agents or paths with data in them | split the batch; strip query strings |
| `415 UNSUPPORTED_MEDIA_TYPE` | server endpoint without `Content-Type: application/json` | set the header |
| `429 RATE_LIMITED` | more than {{RATE_SERVER_PER_MIN}} requests/minute for one key | you are sending one request per event — batch instead |
| `rejected: INVALID_EVENT` | a field breaks the contract; the message names it | compare with the table in [chapter 2](02-server-contract.md) |
| `rejected: EVENT_TIME_OUT_OF_RANGE` | **clock skew** (server clock wrong), timestamps without `Z`/offset interpreted as wrong time, or a queue replayed after days | enable NTP; always send `Z` or an offset; drop events older than {{MAX_BACKDATE_DAYS}} days |
| `rejected: PATH_OUTSIDE_APP` | browser path without your base path | include the base path (`usePathname()` omits it in Next.js) |
| `warnings: FIELD_DROPPED` on `ip` | not an IP address (e.g. a hostname or `unknown`) | send only resolved addresses (chapter 6) |
| `warnings: FIELD_DROPPED` on `userEmail` | not an email (user id, name, `null` as a string) | send the verified email or omit the field |
| every resend counts as new (`duplicates` always 0) | `eventId`/`occurredAt` regenerated per attempt | build the event once, resend the same object |

## The data looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| almost all IPs are `10.x`, `172.16–31.x`, `192.168.x` | **private IP ratio** too high: `trustProxyHops` too low — you record your gateway | count your proxies ([chapter 6](06-client-ip.md)) |
| locations jump to odd countries | `trustProxyHops` too high — forged `X-Forwarded-For` wins | lower it to your real proxy count |
| no users, everything anonymous | identity read before your auth ran, or the wrong property | read it in `getUser` at response end; log `typeof` once to check |
| one person owns all traffic | a hard-coded fallback user in non-production code paths | remove the fallback |
| thousands of "endpoints" | no `routeTemplate`, ids in paths | send `routeTemplate` |
| p95 latency very high | downloads/SSE counted as normal requests | mark them `kind: "stream"` (the snippets detect common cases) |
| health checks dominate | not skipped | skip `/health`, `/ready`, static files |
| nothing arrives, no errors in logs | `NEXUS_URL` empty in that environment (the client is a no-op) | set it; check the process environment, not just `.env` |

## Integration page warnings

The dashboard's Integration page ([chapter 10](10-verify.md)) flags these per app:

| Warning | Cause | Fix |
|---|---|---|
| **exposed secret key** | an `nx_sk_` key reached the browser endpoint (`403 SECRET_KEY_EXPOSED`) | treat it as leaked: new key → deploy → revoke the old one ([chapter 1](01-getting-keys.md)); use the `nx_pk_` key in the browser |
| **private IPs** (more than 90 % of server events) | `trustProxyHops` too low — you record your own gateway | count your proxies ([chapter 6](06-client-ip.md)) |
| **clock skew** | the sending host's clock is off (skew = our receive time − your `sentAt`) | enable NTP; compare with `serverTime` from `/v1/ingest/verify` |
| **rejected events** | events break the contract | the `rejected[].code` of our 202 responses names the field ([chapter 4](04-responses-retries.md)) |
| **rate limited** | more than the per-key request limit | batch events instead of one request per event |
| **stale** | events used to arrive but stopped | a deploy dropped the middleware, `NEXUS_URL` or the key; check the `[nexus]` warnings in your logs |
| **never** | no event has ever arrived | run the checks of [chapter 10](10-verify.md) from the host that sends |
