# 01 — Project overview

## The problem

Six internal apps run under `https://nexus.libas.in/` — AgreementVault (`/ai-agreement`),
EBO_SALES (`/ebo-sales`), EBO_STOCK_AUDIT (`/ebo-audit`), finance-tool (`/finance-gst-tracker`),
Finance_recon (`/finance-reco`) and stockapp (`/virtual-stock`). Nobody can currently answer:

- Who uses which app, and how often?
- Which API endpoints are slow or failing, for whom?
- Where (country/city) do users connect from?
- Which UI tools/features are actually used, and how do users move through the app (journeys)?
- How long do people spend on each page?

Each app has its own ad-hoc logging; nothing is shared or real-time.

## What Data Nexus Traffic does

1. **Receives events** from the apps through a small, versioned HTTP **ingest API**:
   - *server events* from a backend middleware — one per API request: method, path, route
     template, status, duration, client IP, the signed-in user's email;
   - *browser events* from a frontend React hook — page views, time on page, tool usage, custom events.
2. **Enriches** each event: IP → country/region/city (geoip-lite), user agent → browser/OS/device,
   identity → how trustworthy the user identity is.
3. **Stores** them in PostgreSQL (monthly partitions, configurable retention).
4. **Shows** them on a dashboard behind the company SSO, with a live view pushed over Socket.io.
5. **Publishes a guide** at `https://nexus.libas.in/traffic/api/docs/` so other teams can integrate.

## Who uses it

| Who | What they do |
|---|---|
| Dashboard viewers (allow-listed emails) | read analytics, live feed, journeys |
| Dashboard admins (`DASHBOARD_ADMIN_EMAILS`) | register apps, issue/expire/revoke API keys, see IP addresses |
| Other teams | read the public guide, add the middleware/hook to their apps, check *Integration Health* |
| Team Lead | deploys with Docker Compose, configures nginx and `.env` |

## The hard rule

**We never modify the projects in `D:\server`.** Our deliverable is the platform plus the API
contract and guide. The appendix of the guide (`docs/integration/appendix-per-app-hints.md`)
contains *informational* hints about where each app could add the middleware — the teams own that work.
**Exception:** EBO_SALES is the user's own app; we integrated it ourselves as the reference
integration ([ADR 0003](decisions/0003-ebo-sales-reference-integration.md)).

## What data we collect — and what we never collect

| Collected | Never collected |
|---|---|
| HTTP method, path **without query string**, route template, status, duration | request/response bodies, headers, cookies, tokens, passwords |
| client IP (configurable: full / truncated / hashed) and derived geo | query strings, URL fragments, form values, user-typed text |
| the **verified** signed-in email (server side) or SSO-cookie email (browser) | phone numbers, PAN/GST numbers, cost data |
| page views, visible time per page, UI tool names, static labels | error **messages** (only error *codes*), page titles (v1) |

Emails are masked in all server logs; IPs are shown on the dashboard to admins only.

## Glossary

See [GLOSSARY.md](GLOSSARY.md). The most important terms: **app**, **server event**,
**browser event**, **tool**, **endpoint**, **session**, **identity source**, **secret key**,
**publishable key**.
