# Glossary — one noun per concept

| Term | Meaning | Where in code |
|---|---|---|
| **app** | One integrated application (e.g. `ebo-sales`). Identified publicly by its **slug**. | table `apps`, `ROUTES.apps.*` |
| **slug** | Lower-case id of an app, e.g. `ebo-sales`. Staging is normally told apart by **environment**; a separate `-dev` slug (`ebo-sales-dev`) is still allowed. | `APP_SLUG_PATTERN` |
| **base path** | The URL prefix an app lives under, e.g. `/ebo-sales`. Browser events must stay inside it. | `apps.base_path` |
| **server event** | One backend API request reported by an app's middleware. Stored in `api_requests`. | `serverEventSchema` |
| **browser event** | One frontend event: `page_view`, `page_time`, `tool_use` or `custom`. Stored in `web_events`. | `browserEventSchema` |
| **page view** | A `page_view` event; its `eventId` is the **page view id**. | |
| **page time** | A `page_time` event: a *delta* of visible milliseconds for one page view. Summed = time on page. | |
| **tool** | A named UI feature, e.g. `audits.export-csv`, reported by `tool_use`. | `TOOL_NAME_PATTERN` |
| **endpoint** | One (app, HTTP method, route template). Identified by an opaque **endpointId** (UUID v5). | `toEndpointId()` |
| **route template** | The parameterised path, e.g. `/ebo-sales/api/stores/:id` (`:name` = one segment, trailing `:name*` = catch-all). Browser templates are kept only when they fit the path. | `isPlausibleRouteTemplate()` |
| **session** | One browser tab's visit: all browser events with the same (app, sessionId). Idle > 30 min → new session. | |
| **visit** | The on-screen word for a **session** (nav "Visits", the person page's "View visits", the Visits KPI and column). Counts browser sessions only: a person or device seen only through API calls has 0 visits. | `PAGES.journeys()`, `ROUTES.journeys.sessions` |
| **journey** | The ordered list of a session's page views, tool uses and correlated API calls. | `ROUTES.journeys.*` |
| **identity source** | How much we trust the user on an event: `sso_cookie` > `app_attested` > `client_claimed` > `anonymous`. | `IDENTITY_SOURCE_VALUES` |
| **user key** | Opaque HMAC of a user's email, used in URLs instead of the email. | `user_key` column |
| **secret key** | `nx_sk_…` — server-side only. Authenticates server events. | `KEY_PREFIXES.secret` |
| **publishable key** | `nx_pk_…` — write-only, safe in browser bundles. Authenticates browser events. | `KEY_PREFIXES.publishable` |
| **ingest** | Receiving events through `/v1/ingest/*`. | `ROUTES.ingest.*` |
| **enricher** | A small class that adds/cleans one aspect of an event (geo, UA, identity…). | `apps/api/src/enrichment/` |
| **tick** | A live update with the current minute's cumulative counters, every 2 s. | `SOCKET_EVENTS.trafficTick` |
| **scope** | What a live subscription covers: `all` or `app:<slug>`. | `liveScopeKey()` |
| **viewer / admin** | Dashboard roles. Admins manage apps/keys, see IPs and are the only ones who may read person-level data (ADR 0015). | `DASHBOARD_ADMIN_EMAILS` |
| **person-level read** | Anything about ONE person: the person page (`PERSON_ROUTE_LEAVES`) or a list narrowed by `?userKey=` (`PERSON_FILTERED_ROUTE_LEAVES`). Admin-only, recorded in the person access log. | `packages/shared/src/routes.ts` |
| **person page (Person 360)** | The admin-only page of ONE verified user over the global range: identity card + tabs Summary, Daily activity, Devices, Activity (`?tab=`). ADR 0014 / 0015. | `PAGES.userDetail()`, `apps/web/src/features/users/UserDetailView.tsx` |
| **tab visible time / time in app** | Per-person day facts with neutral names (ADR 0017). Tab visible time = Σ credited `page_time.visible_ms` (two visible tabs both count; one row counts at most `VISIBLE_DELTA_CREDIT_CAP_MS`, 60 s, so a sleeping laptop adds at most 1 minute); time in app = the union of visible intervals (overlap counted once; it arrives with the one-day view). Neither is keyboard or mouse use. Formerly "Active time (tab visible)". | `METRIC_COPY.activeTime`, `listUserDailyActivity`, `apps/web/src/features/users/AboutTheseNumbers.tsx` |
| **daily activity** | One row per IST day for one person: first activity, last activity (today "so far", `inProgress`), tab visible time, apps (one line per app in first-use order with its own tab visible time — "no browser time" for API-only apps — and first – last event; `perApp`), page views, feature uses, API calls, failed, visits (linked to that day's Visits). Days without activity are left out of the table; the "Tab visible time per day" chart draws them as 0. ADR 0017. | `ROUTES.users.daily`, `UserDayActivityDto`, `UserDayAppActivityDto` |
| **access log (person access log)** | Append-only record of which admin opened which part (surface) of whose person page, and when; the person named by a masked email. Coalesced: one row per admin + person + surface per 10 min. Read on Privacy & access. ADR 0015. | table `person_access_log`, `ROUTES.privacy.accessLog`, `PERSON_ACCESS_SURFACE_VALUES` |
| **one-day view** | One IST day of one person (`?tab=daily&day=YYYY-MM-DD`): first / last activity, time in app, apps, visits, the activity blocks on a 00:00-24:00 timeline, apps, pages and features in first-use order, visits with Visit steps links. App and env apply, the global range does not. ADR 0017. | `ROUTES.users.day`, `UserDayDetailDto`, `UserDayDetail.tsx` |
| **activity block / time in app** | A block is a stretch of one person's browser events whose breaks are all under 5 min (length = end − start, never summed). Time in app = the union of page-visible intervals (two tabs at once count once); tab visible time is their sum. ADR 0017. | `listUserDayBlocks`, `UserActivityBlockDto` |
| **usual activity hours** | A 7 × 24 grid (Mon..Sun × 00..23, India time) of one person: per weekday-hour, on how many of that weekday's days in the last 7 or 30 days any activity was recorded, and the tab visible time in it. One colour, darker = more of those days; not sign-in times. Built and tested, shown only once `USUAL_ACTIVITY_HOURS_ENABLED` is on. ADR 0017. | `ROUTES.users.pattern`, `UserActivityPatternDto`, `HourGrid.tsx` |
| **surface** | Which part of a person-level read an access-log row is about (`person_profile`, `person_daily`, `person_visits`, …). | `PERSON_ACCESS_SURFACE_VALUES` |
| **today (range preset)** | The current IST calendar day, 00:00 to the next 00:00; compared with the same elapsed span of yesterday (`elapsedTo`). ADR 0014. | `RANGE_VALUES`, `resolveTimeWindow()` |
| **page hero** | The band that opens every page: the section's icon tile, the title, and on list pages the nav item's one English `question` plus, from md up, the section's illustration. ADR 0014 / 0016. | `apps/web/src/components/PageHeader.tsx`, `NAV_ILLUSTRATIONS` |
| **illustration / state art** | Decorative inline SVG drawn with theme tokens and always aria-hidden: one hero motif per nav item, and the small scenes that open empty, error, admins-only, no-access and not-found states. ADR 0016. | `apps/web/src/components/illustrations/`, `apps/web/src/components/StateArt.tsx` |
| **page end** | The footer under every page: "End of <page>", or "Still loading…" / "More rows above" when that is the truth. ADR 0014. | `apps/web/src/components/PageEnd.tsx` |
| **dry run** | `?dryRun=1` on server ingest: validate everything, write nothing. | |
| **environment** | Which deployment an event came from: `prod`, `staging` or `dev`. Sent per batch (lenient), loopback browser origins are always `dev`, absent = `prod`. Dashboards filter on it (`?env=`, default prod); Live is prod only. ADR 0008. | `ENVIRONMENT_VALUES`, `resolveEnvironment()` |
| **release** | The sender's build label (git sha, version) on server events and, since Phase A, on browser batches. Feeds release coverage. | `release` columns |
| **remote config** | Per-app module switches the browser SDK fetches from `POST /v1/ingest/config`; it can only DISABLE modules. ADR 0009. | `SdkRemoteConfig`, `SDK_CAPTURE_MODULE_VALUES` |
| **kill switch** | `apps.browser_ingest_enabled = false`: browser ingest answers `403 BROWSER_INGEST_DISABLED`, and the SDK stops on any kill code. | `SDK_KILL_ERROR_CODES` |
| **key scope** | The first 14 chars of a (trimmed) publishable key — how the browser SDK keys its caches, retry queue and kill state per app. | `keyScope()` (packages/react) |
| **early install** | `installNexusEarly()` from `@nexus/react/early`: header propagation before the tracker mounts (Next `instrumentation-client.ts`, Vite first-import module). ADR 0011. | `packages/react/src/early.ts` |
| **header propagation** | The tracker adding `X-Nexus-Session` / `X-Nexus-Page-View` to the app's own same-origin fetch / XHR calls (default on), so API calls link to page views. | `INGEST_HEADERS` |
| **retry queue** | Failed browser batches kept in localStorage per key scope and replayed (`client.replay: true`) on the next page load; replays are stored anonymous. ADR 0012. | `SDK_DEFAULTS.browser.retryQueue*` |
| **PII scrubber** | Ingest-time detector of email / phone / PAN / GSTIN / Aadhaar in free-text fields: replace or drop, `FIELD_REDACTED`, count in `pii_detections`. Never rejects. ADR 0010. | `PiiScrubber`, `constants/pii.ts` |
| **linkable / linked** | Linkable = an `http` API call from a desktop / mobile / tablet browser (could carry the session header); linked = linkable with `session_id`. | `coverage-predicates.ts` |
| **identified** | A row with a verified user (`user_key IS NOT NULL`). Applications: both sources combined; Integration Health: per source. | `IDENTIFIED_SQL` |
| **integration level** | `not_connected` → `partial` → `connected` → `complete` (coverage targets met, no blocking warning). ADR 0013. | `INTEGRATION_LEVEL_VALUES`, `integrationLevelOf()` |
| **rejection reason** | An hourly count of refused events by code, normalised SDK label and normalised schema path — never a message. | table `ingest_rejections` |
| **SSO cookie outcome** | What happened to the `access_token` cookie on a browser batch (`ok`, `no-cookie`, `expired`, …) and the beacon origin. | table `sso_cookie_outcomes` |
| **role mode** | `DB_APP_ROLE_MODE`: `owner` = the api uses the migrate login (production, external server); `separate` = the api runs as `nexus_app`, DML only (localdb). ADR 0002. | `apps/api/src/db/migrate-config.ts` |
| **localdb** | The compose profile that starts a local `postgres:18-alpine` container (laptops, CI, rehearsals). Production uses the external server 10.150.0.5 instead. | `docker-compose.yml` |
