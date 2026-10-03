# Verify your integration

Four checks, in order. Each takes a minute.

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

## 4. Real traffic

Deploy, click through your app for a minute, then open your app on the dashboard's **Integration**
page: [{{PUBLIC_URL}}/integration]({{PUBLIC_URL}}/integration) (portal sign-in). No dashboard access?
Ask {{DOCS_CONTACT}} to check it for you.

### What the Integration page shows

| Item | What it tells you |
|---|---|
| Status | **healthy** (events are arriving), **stale** (nothing for a while — did a deploy drop the middleware or `NEXUS_URL`?) or **never** (no event has ever arrived) |
| Last server event / last browser event | when your backend middleware and your frontend tracker last delivered |
| Counters (last 24 h) | per source: `accepted`, `duplicates`, `rejected`, `rate limited` |
| SDKs | every SDK name@version that sent events, with its clock skew (our receive time minus your `sentAt`) |
| Warnings | the problems below — each one links to the chapter that fixes it |

| Warning | Meaning | Fix |
|---|---|---|
| Exposed secret key | an `nx_sk_` key was sent to the browser endpoint | treat it as leaked: create a new key, deploy it, revoke the old one ([chapter 1](01-getting-keys.md)) |
| Private IPs (> 90 %) | your events carry your own proxy's address, not the user's | set `trustProxyHops` to your real proxy count ([chapter 6](06-client-ip.md)) |
| Clock skew | your server's clock is off by more than about a minute | enable NTP on the host; events too far off are rejected |
| Rejected events | some events break the contract | read `rejected[].code` in our responses ([chapter 4](04-responses-retries.md), [chapter 11](11-troubleshooting.md)) |
| Rate limited | you hit the per-key request limit | batch events — never one request per event |
| Stale / never | events stopped, or never started | check `NEXUS_URL` and the key in **this** environment, then steps 1–3 above |

What good looks like:

| Check | Good | If not |
|---|---|---|
| Events arrive | your endpoints appear within a minute | logs show `[nexus]` warnings? see chapter 11 |
| Route templates | `/my-app/api/stores/:id`, not one row per id | send `routeTemplate` (chapter 2) |
| IP addresses | public addresses, varied countries/cities | wrong `trustProxyHops` (chapter 6) |
| Users | signed-in users show an email | `getUser` reads too early or the wrong field (chapter 7) |
| Status codes | your 4xx/5xx show up | the middleware is mounted after an error handler that ends the response |
| `rejected` / `warnings` | zero | the codes tell you which field (chapter 4) |
