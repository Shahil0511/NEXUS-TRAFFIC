# Glossary — one noun per concept

| Term | Meaning | Where in code |
|---|---|---|
| **app** | One integrated application (e.g. `ebo-sales`). Identified publicly by its **slug**. | table `apps`, `ROUTES.apps.*` |
| **slug** | Lower-case id of an app, e.g. `ebo-sales`. Staging uses its own slug (`ebo-sales-dev`). | `APP_SLUG_PATTERN` |
| **base path** | The URL prefix an app lives under, e.g. `/ebo-sales`. Browser events must stay inside it. | `apps.base_path` |
| **server event** | One backend API request reported by an app's middleware. Stored in `api_requests`. | `serverEventSchema` |
| **browser event** | One frontend event: `page_view`, `page_time`, `tool_use` or `custom`. Stored in `web_events`. | `browserEventSchema` |
| **page view** | A `page_view` event; its `eventId` is the **page view id**. | |
| **page time** | A `page_time` event: a *delta* of visible milliseconds for one page view. Summed = time on page. | |
| **tool** | A named UI feature, e.g. `audits.export-csv`, reported by `tool_use`. | `TOOL_NAME_PATTERN` |
| **endpoint** | One (app, HTTP method, route template). Identified by an opaque **endpointId** (UUID v5). | `toEndpointId()` |
| **route template** | The parameterised path, e.g. `/ebo-sales/api/stores/:id`. | |
| **session** | One browser tab's visit: all browser events with the same (app, sessionId). Idle > 30 min → new session. | |
| **journey** | The ordered list of a session's page views, tool uses and correlated API calls. | `ROUTES.journeys.*` |
| **identity source** | How much we trust the user on an event: `sso_cookie` > `app_attested` > `client_claimed` > `anonymous`. | `IDENTITY_SOURCE_VALUES` |
| **user key** | Opaque HMAC of a user's email, used in URLs instead of the email. | `user_key` column |
| **secret key** | `nx_sk_…` — server-side only. Authenticates server events. | `KEY_PREFIXES.secret` |
| **publishable key** | `nx_pk_…` — write-only, safe in browser bundles. Authenticates browser events. | `KEY_PREFIXES.publishable` |
| **ingest** | Receiving events through `/v1/ingest/*`. | `ROUTES.ingest.*` |
| **enricher** | A small class that adds/cleans one aspect of an event (geo, UA, identity…). | `apps/api/src/enrichment/` |
| **tick** | A live update with the current minute's cumulative counters, every 2 s. | `SOCKET_EVENTS.trafficTick` |
| **scope** | What a live subscription covers: `all` or `app:<slug>`. | `liveScopeKey()` |
| **viewer / admin** | Dashboard roles. Admins manage apps/keys and see IPs. | `DASHBOARD_ADMIN_EMAILS` |
| **dry run** | `?dryRun=1` on server ingest: validate everything, write nothing. | |
| **role mode** | `DB_APP_ROLE_MODE`: `owner` = the api uses the migrate login (production, external server); `separate` = the api runs as `nexus_app`, DML only (localdb). ADR 0002. | `apps/api/src/db/migrate-config.ts` |
| **localdb** | The compose profile that starts a local `postgres:18-alpine` container (laptops, CI, rehearsals). Production uses the external server 10.150.0.5 instead. | `docker-compose.yml` |
