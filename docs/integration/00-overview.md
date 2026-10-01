# Overview

**Data Nexus Traffic** shows, for every app on `nexus.libas.in`, who uses it, which APIs are slow or
failing, where users connect from, and what people actually do in the UI. Your app sends us small,
structured events over HTTPS; we enrich them (geo from IP, browser from user agent, verified identity)
and show them on a live dashboard.

This guide is everything your team needs to wire it in. **You own the changes in your repository —
Nexus never edits your code.** If anything here is unclear, contact {{DOCS_CONTACT}}.

> **Status (draft, contract v{{CONTRACT_VERSION}}).** The **server endpoint is live**. The browser
> endpoint and the reference React tracker (`@nexus/react`) follow shortly — the browser payload in
> [chapter 3](03-browser-contract.md) is final, so you can plan against it. Changes are announced in
> the changelog (see below).

## The two data flows

```text
 Your backend  ── one event per API request ──▶  POST {{API_URL}}/v1/ingest/server
 (middleware)     batched, secret key in the       X-Nexus-Key: nx_sk_…
                  X-Nexus-Key header

 Your frontend ── page views, time on page,  ──▶  POST {{API_URL}}/v1/ingest/browser
 (tracker hook)   tool clicks, custom events       publishable key nx_pk_… in the body
```

| Flow | What it answers | Who sends it | Key |
|---|---|---|---|
| **Server events** | Which endpoints are called, how fast, how often they fail, by whom, from where | your backend middleware | secret `nx_sk_…` (server env only) |
| **Browser events** | Which pages people open, how long they stay, which tools they use, their journey | your frontend tracker | publishable `nx_pk_…` (safe in a bundle) |

Most teams start with the server flow (one middleware, about 15 minutes of work), then add the
browser tracker.

## Endpoints

Everything lives under one base URL. We call it `NEXUS_URL` throughout this guide:

```text
NEXUS_URL = {{PUBLIC_URL}}
```

| Method | URL | Purpose |
|---|---|---|
| `POST` | `{{SERVER_URL}}` | backend events (chapter 2) |
| `POST` | `{{BROWSER_URL}}` | frontend events (chapter 3) |
| `GET` | `{{VERIFY_URL}}` | check a key and read the server clock (chapter 10) |
| `GET` | `{{DOCS_URL}}` | this guide |
| `GET` | `{{DOCS_URL}}openapi.json` | the machine-readable contract (OpenAPI 3.1) |

## Your integration checklist

1. **Get keys** for your app — [chapter 1](01-getting-keys.md).
2. **Verify** the key with one curl command — [chapter 10](10-verify.md).
3. **Add the server middleware** — pick your stack in [chapter 8](08-recipes.md).
4. **Add the browser tracker** — [chapter 3](03-browser-contract.md).
5. **Check the result** — dry run, then the dashboard — [chapter 10](10-verify.md).

## Five rules that matter most

1. **Never break your app.** Send in the background, in batches, with a timeout. Never `await` our API
   inside a user request. If we are down, drop the events. The reference snippets do all of this.
2. **The secret key stays on the server.** Only the publishable key may appear in browser code.
3. **One `eventId` per event, created once.** Reuse the same event object on retries — that is how
   we discard duplicates.
4. **No personal data beyond the user's email and IP.** No bodies, no query strings, no tokens —
   see [chapter 5](05-pii.md).
5. **Send the real client IP and the verified user** — [chapter 6](06-client-ip.md) and
   [chapter 7](07-user-email.md).

## Contract version and change policy

- The current contract is **v{{CONTRACT_VERSION}}**. It is part of the URL (`/v1/…`).
- Within v1, changes are **additive only**: new optional fields, new event types, new warning codes.
  Your integration keeps working without changes.
- Unknown fields you send are **ignored**, so a newer sender also works against an older server.
- A breaking change ships as **`/v2`** alongside v1, with notice and a migration window.
- Every change is listed in the changelog (`docs/CHANGELOG.md` in the Nexus repository; ask
  {{DOCS_CONTACT}} for a copy).

## Downloads

| File | What it is |
|---|---|
| [openapi.json](openapi.json) | OpenAPI 3.1 description of the ingest API |
| [files/examples/server-batch.json](files/examples/server-batch.json) | a valid server batch |
| [files/examples/browser-batch.json](files/examples/browser-batch.json) | a valid browser batch |
| [files/snippets/](08-recipes.md) | reference code per stack (listed in chapter 8) |
