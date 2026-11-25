# Verify your integration

Five checks, in order. Each takes a minute.

## 1. The key works

```bash
curl -sS '{{VERIFY_URL}}' -H "X-Nexus-Key: $NEXUS_SECRET_KEY"
```

```json
{
  "app": { "slug": "ebo-sales", "displayName": "EBO Sales" },
  "keyKind": "secret",
  "contractVersion": {{CONTRACT_VERSION}},
  "serverTime": "2026-10-01T04:00:00.000Z"
}
```

- `app.slug` is the app this key writes to — check it is yours (not `…-dev` in production).
- `keyKind` is `secret` for the backend key, `publishable` for the browser key (both work here).
- Compare `serverTime` with your server's clock: more than a few seconds apart means NTP is off,
  and events older than {{MAX_BACKDATE_DAYS}} days or more than {{MAX_FUTURE_MINUTES}} minutes ahead
  are rejected.

`401` → the key is wrong, expired or revoked. A redirect or an HTML page → something between you and
us intercepts the call ([chapter 11](11-troubleshooting.md)).

## 2. A dry run with your real payload

Point your middleware at `…/v1/ingest/server?dryRun=1` for a moment, or run
[curl.sh](files/snippets/curl.sh), which does a dry run first. The answer lists what would be
rejected or changed — nothing is stored:

```json
{ "accepted": 1, "duplicates": 0, "rejected": [], "warnings": [], "dryRun": true }
```

Aim for **no `rejected`** and **no `warnings`**.

## 3. A real send, then the same send again

`curl.sh` sends one event and then resends **the same** event:

```text
3) send one event            → 202 {"accepted":1,"duplicates":0,…}
4) resend the SAME event     → 202 {"accepted":0,"duplicates":1,…}
```

If step 4 says `accepted: 1` again, the `eventId` or `occurredAt` changed between attempts — fix that
before going live, or every retry will count twice.

## 4. The browser tracker

Open your app with the browser's developer tools on the **Network** tab:

- a `POST …/api/v1/ingest/config` answers `200` (the remote config; at most every
  {{SDK_CONFIG_MAX_AGE}} minutes, so reload with an empty cache if you miss it);
- `POST …/api/v1/ingest/browser` requests answer `202` with your `environment`, `release` and the
  `routeTemplate` of the page in their payload;
- your own `/api/…` requests — including the very first ones of a page load — carry
  `X-Nexus-Session` and `X-Nexus-Page-View`.

A `403` on either Nexus request means the key, the origin or the kill switch — the body's
`error.code` says which ([chapter 11](11-troubleshooting.md)).

## 5. Real traffic

Deploy, click through your app for a minute, then open your app on the dashboard's **Integration**
page: [{{PUBLIC_URL}}/integration]({{PUBLIC_URL}}/integration) (portal sign-in). No dashboard access?
Ask {{DOCS_CONTACT}} to check it for you.

### What the Integration page shows

Everything covers the last 24 hours and **all environments** (the page is not filtered by
environment, so staging wiring shows up too). Each app is one row: a green, amber or red mark, its
status and integration level, and a one-line summary (the first warning, with **How to fix**).
**Show details** opens the rest of the items in the table below.

| Item | What it tells you |
|---|---|
| Status | **healthy** (events are arriving), **stale** (nothing for a while — did a deploy drop the middleware or `NEXUS_URL`?) or **never** (no event has ever arrived) |
| Integration level | how far the integration has got — see the table below |
| Last server event / last browser event | when your backend middleware and your frontend tracker last delivered |
| Counters | per source: `accepted`, `duplicates`, `rejected`, `rate limited` |
| SDKs | every SDK name and version that sent events, with its clock skew (our receive time minus your `sentAt`) |
| Coverage | **Identified (server / browser)**: share of events with a verified user ([chapter 7](07-user-email.md)). **Linked API calls**: share of linkable API calls (`http` calls from desktop, mobile or tablet browsers) that carry the tracker's session header, and how many carry the page-view header ([chapter 3](03-browser-contract.md)). Shown once a source has {{COVERAGE_MIN_EVENTS}} events. |
| Environments | events per source and environment ({{ENVIRONMENT_VALUES}}) — is staging tagged as staging? |
| Releases | per source: share of events carrying `release`, and the newest release seen |
| Personal data | what the PII detector redacted: source, field, kind and count — never the value ([chapter 5](05-pii.md)) |
| Rejection reasons | why events were refused: code, SDK and the field that failed (e.g. `occurredAt`, `props.*` — never the value or a message) |
| SSO cookie (browser identity) | per browser beacon: what happened to the SSO cookie (`ok`, `no-cookie`, `expired`, …) and whether the beacon came from the collector's own origin |
| Warnings | the problems below — each one links to the chapter that fixes it |

### Integration level

| Level | Meaning |
|---|---|
| **Not connected** | no event has arrived yet |
| **Partial** | only one source sends (server or browser), or nothing arrived recently |
| **Connected** | both sources send |
| **Fully integrated** | connected, **and** at least {{COVERAGE_TARGET}} % of linkable API calls are linked, at least {{COVERAGE_TARGET}} % of browser events are identified, at least {{RELEASE_TARGET}} % of each source's events carry a `release`, and there is no *exposed secret key*, *personal data* or *app disabled* warning. A ratio with too few events ({{COVERAGE_MIN_EVENTS}}) does not count. |

| Warning | Meaning | Fix |
|---|---|---|
| Exposed secret key | an `nx_sk_` key was sent to the browser endpoint | treat it as leaked: create a new key, deploy it, revoke the old one ([chapter 1](01-getting-keys.md)) |
| Personal data detected | the PII detector redacted an email, phone number, PAN, GSTIN or Aadhaar number in your events | find the field in the *Personal data* panel and stop sending it ([chapter 5](05-pii.md)) |
| Private IPs (> 90 %) | your events carry your own proxy's address, not the user's | set `trustProxyHops` to your real proxy count ([chapter 6](06-client-ip.md)) |
| Clock skew | your server's clock is off by more than about a minute | enable NTP on the host; events too far off are rejected |
| Rejected events | some events break the contract | read `rejected[].code` in our responses ([chapter 4](04-responses-retries.md), [chapter 11](11-troubleshooting.md)) |
| Rate limited | you hit the per-key request limit | batch events — never one request per event |
| Stale / never | events stopped, or never started | check `NEXUS_URL` and the key in **this** environment, then steps 1–3 above |

What good looks like:

| Check | Good | If not |
|---|---|---|
| Events arrive | your endpoints appear within a minute | logs show `[nexus]` warnings? see chapter 11 |
| Route templates | `/my-app/api/stores/:id`, not one row per id | send `routeTemplate` (chapter 2; browser: chapter 3) |
| Environment | production traffic under `prod`, staging under `staging`, laptops under `dev` | set `NEXUS_ENVIRONMENT` / the tracker's `environment` (chapter 9) |
| Release | every event carries one; the newest release is the one you just deployed | set `NEXUS_RELEASE` / the tracker's `release` (chapter 9) |
| Linked API calls | close to 100 % for a single-page app | mount the early install, check CORS for other origins (chapters 3 and 8) |
| IP addresses | public addresses, varied countries/cities | wrong `trustProxyHops` (chapter 6) |
| Users | signed-in users show an email | `getUser` reads too early or the wrong field (chapter 7) |
| Status codes | your 4xx/5xx show up | the middleware is mounted after an error handler that ends the response |
| `rejected` / `warnings` | zero | the codes tell you which field (chapter 4) |
| Personal data | nothing | the panel names the field — fix the sender (chapter 5) |
