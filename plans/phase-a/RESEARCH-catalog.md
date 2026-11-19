## Aaj kya hai

- **What we collect.** We get one server event per API request: method, path without the query, route template, status, duration, IP turned into geo, parsed user agent, verified email, error code, release, session id and page-view id. From the browser we get page views, visible time per page, `tool_use` clicks (only on elements marked with `data-nexus-tool`) and custom events. A user counts as identified only through the SSO cookie or an email that the app's backend sends with its secret key.
- **What the dashboard shows.** Overview, Applications, API Routes, Errors, Users and User detail, Journeys, Pages, Tools, Geography, Live ("who's online now"), Integration health and Apps admin. Every page is a fixed report. None of them lets you build your own question.
- **The data is small.** About 28k rows in 30 days, 38 verified users (13 use more than one app) and 7 apps. nexus-portal sends browser events only.
- **Identity is weak.** We know only the email. There is no name, department, store, role, region or manager, so no chart can be cut by org. ebo-kpiverse, finance-recon and finance-tool send no verified user at all, and about 38% of nexus-portal page views have no verified user. The Users page counts verified people only, so those apps look empty.
- **API calls are often not linked to the page that made them.** 64% of stockapp calls and 29% of ebo-sales calls have no session id. The cause is the SDK: header propagation is opt-in, it covers `fetch` only (not XHR or axios), it works only for same-origin calls, and it is installed too late for clients that grab `fetch` when they load (openapi-fetch).
- **Pages are grouped wrongly.** The React SDK never sends `routeTemplate`, so the server guesses it. In stockapp, for example, every product gets its own page.
- **Tool tracking barely covers anything.** Only 4 of about 30 EBO tool ids were ever seen, and the other apps have no markup. There is no autocapture of unmarked clicks.
- **Some data is stored but never used, and some is thrown away.** Browser, OS and device facets, `anonymous_id` (needed for new vs returning devices), referrer host, release, request/response bytes and tool/custom-event props are all written to the database, but nothing reads them. Client timezone and language are sent by the SDK and then dropped.
- **There is no frontend visibility.** We capture no JS errors, no Web Vitals, no failed browser requests, and no rage clicks, dead clicks, scroll depth or form signals. The "Replay" in Journeys is a text list of events, not a visual replay.
- **There is no analytics or alerting layer.** No funnels, retention, cohorts, stickiness or lifecycle, and paths stop at the fixed top 3-step list. There are no alerts, scheduled reports, saved views or CSV export. Pages, Tools and Geography show the top N only. Queries run on raw tables, so ranges are capped at 31 days (percentiles) and 93 days (counts), and raw data is kept for only 6 months.
- **Location is empty.** 100% of IPs are private or loopback (office LAN, VPN or a proxy hiding the client IP), so the Geography page tells us nothing.
- **Governance is basic.** Dashboard access is a simple viewer or admin switch. There is no per-app scoping and no log of who viewed which employee. Live shows `activeUsers: 0` on past ticks, and the online list stops at 100 people.

## Data jo hum la sakte hain

**How to read these tables**

- **App team ka kaam**
  - *None* means all the work is on our side.
  - *SDK upgrade* means the team bumps the vendored `@nexus/*` package. That is small work for them, but it only reaches users when each team does it.
  - *Wiring (small)* means a few lines or one config option in their app.
  - *Wiring* means per-app design work, for example deciding which actions count as "approvals".
  - *External owner* means HR, IT or the portal team must supply data or access. We cannot edit their systems (hard rule 1).
- **Effort** is for one developer: S is up to 1 week, M is 1 to 3 weeks, L is 3 to 6 weeks, and XL is more than 6 weeks.
- **Value** is Must, High, Medium or Low.
- **Privacy risk** is Low, Medium or High, rated for what the feature newly exposes. "Reduces risk" marks a governance control.
- **Legal wording.** Under DPDP, Nexus processing would rely on s.7(i) (employment purposes). The relevant legal hooks are purpose limitation, s.8(5) security safeguards, s.8(7) erasure after the purpose ends, and Rules 6 and 8. Things like the "notice", "aggregate-first" and minimum group sizes are policy and trust choices that legal will probably recommend. They are not statutory proportionality tests. Legal has the final word.

### M0. Data quality, identity coverage and SDK platform (new: prerequisites for everything else)

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| SDK remote config and kill switch | Lets us switch any capture on or off per app without the team redeploying. Lets us disable a capture that breaks or slows an app. | Versioned per-app config (capabilities, sampling, allow-lists, exclusions), signed and cached. It fails closed, meaning it falls back to minimal capture. The config version is stamped on events. | SDK upgrade (once) | M | Must | Reduces risk |
| SDK performance budget | Proves that Nexus never slows or breaks a host app, including on low-end store tablets. | A max gzipped size for the core SDK, lazy-loaded modules per capability, and a long-task/CPU budget checked in CI. The SDK reports its own overhead to Integration health. Every capture runs inside try/catch so a Nexus error never surfaces in the app. | SDK upgrade | M | Must | Low |
| SDK distribution and version matrix | Shows which app runs which SDK version and capabilities, and who is behind. | A per-app SDK version and capability matrix, an "integration level" badge, and a version target per app. The open question is a private npm registry vs versioned vendoring. | Wiring (small, once) if we move to a registry | M | Must | Low |
| Identity coverage workstream and KPI | Shows what % of events are verified per app, and helps close the gap for ebo-kpiverse, finance-recon, finance-tool and nexus-portal. | % verified per app per day shown on Integration health. A fix so the existing SSO-cookie path works for every app (cookie domain, SameSite and same-site beacon checks), which needs no app code. Server `getUser` set up for the 3 anonymous apps. | None for the browser path. Wiring (small) for server `getUser`. | M | Must | Low |
| Persistent retry queue for browser events | Stops silent event loss on flaky store and warehouse networks, which otherwise pushes store-level numbers down. | A bounded IndexedDB queue with a TTL under 7 days (events older than 7 days are rejected at ingest). Counters for retried and dropped events. | SDK upgrade | M | High | Low |
| Ingest-time PII leak detector | Catches PAN, GSTIN, Aadhaar, phone numbers or emails that leak into paths, templates, props, labels or selectors, before autocapture widens the surface. | A scrub-or-reject rule set in `packages/shared`. Leak counters per app and field on Integration health. Payloads are never stored. | None | M | Must | Reduces risk |
| Privacy regression tests | Guarantees no new event type can carry query strings, element text or disallowed attributes. | Contract tests per event type, plus allow-list tests for autocapture and replay. | None | S | Must | Reduces risk |
| Environment and internal-traffic hygiene | Keeps dev and staging traffic, QA testers, the Nexus team, service accounts and cron calls out of DAU, funnels and alerts. It also fixes the localhost dev cookie (admin@libas.in) polluting data. | An `environment` field (prod/staging/dev) on both envelopes. An `is_internal` / `service_account` flag derived from person and route lists. Dashboards exclude these by default. | SDK upgrade + Wiring (small): set `environment` | S-M | High | Low |
| SDK debug mode, live event inspector and staging key | Lets app teams confirm their instrumentation works before they ship. | A debug flag that shows events in the console or an overlay, a per-app staging ingest key, a "live events for my app" view, and a per-app instrumentation checklist. | Optional | M | High | Low |
| Browser ingest integrity | Stops forged browser events (publishable keys ship in bundles) from creating or hiding activity. | Rule: browser events are never evidence for audit or security. Per-key and per-session quotas, Origin checks, and a client-vs-server consistency check (browser activity with no matching server calls). | None | S-M | Medium | Low |
| Data-accuracy reconciliation | Builds trust by comparing Nexus counts with the app's own numbers (for example, audits submitted). | A reconciliation report per app per month showing the difference in %. | Wiring (small): the app gives us a count endpoint or a monthly figure | M | High | Low |
| Non-React SDK path | Covers apps or devices without React (plain script tag, Android WebView or handheld scanners, if they are in scope). | A vanilla JS build of the core tracker. | SDK upgrade / Wiring (small) | M | Medium | Low |

### M1. Identity, org directory and User 360

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Show the dimensions we already store | Which browsers, OS and devices staff use, which release each user is on, new vs returning devices, timezone and language mix, external referrer, and why visible time ended. | `client_tz` and `client_lang` columns (already sent today, currently dropped). The rest is read side only: UA facets, `anonymous_id`, `release`, `referrer_host`, `nav`, `time_reason`. | None | S | High | Low |
| Show unverified activity honestly | How much usage comes from apps with no identity wiring, how many anonymous devices there are, and how many claimed users. | Distinct `anonymous_id` and `claimed_email` per app, shown in separate labelled columns and never added to identified counts. | None | S | High | Low |
| Employee directory (SCD2 employee and store dimension) | Which department, store, region, role or manager's team this activity comes from, both today and on the day it happened. | `employee_dim` (person, employee id, display name, department, designation, store code, region/zone, cost centre, manager, employment type, join and exit dates, valid_from/valid_to). `store_dim` (code, name, city, state, format EBO/MBO/warehouse/HO, area manager). `directory_sync_runs`. Allow-listed fields only: no phone, address, PAN or salary. | External owner: HR/IT provide a CSV (the primary path) or an HRMS/IdP API later, and name an owner for data accuracy | M (CSV) / L (API) | Must | Medium |
| Account type and shared-login handling | Which "users" are really a shared store login or a service account, so they don't distort per-person views. | `account_type` (person / shared_store / service) in `employee_dim`. The share of activity on shared accounts per store. Shared accounts count only in group analytics and never in per-person scores, UEBA or proficiency. | External owner: HR/IT tag shared accounts. Rule-based detection as a fallback. | S-M | High | Low |
| Org dimensions joined at query or rollup time | Unique stores or departments per app, adoption per store or role, and funnels by role. | No new columns on raw events. We join to the SCD2 dimension on `valid_from`/`valid_to` and stamp org keys only into rollups. A re-stamp job runs when the directory changes. Claimed identities never get org keys. | None | M | Must | Low |
| Verified user traits via `getUserTraits` | The app role as the app itself knows it (for example store_manager or approver), where the directory lacks it. | An optional `userTraits` on server events: up to 10 allow-listed keys, with a DB CHECK. A `user_traits_snapshot` table per person and app. Default SSO-claim reading ships only if a read-only check of the portal JWT payload shows those claims exist. Today the portal verifier returns only email and expiry. | Wiring (small). If we want claims added to the portal token, that is a request to the portal team. | M | High | Medium |
| `person_id` re-key, alias table and secret rotation | The same person across 7 apps, browser and server, and after an email change. It also lets `USER_KEY_SECRET` rotate without breaking history. | `persons(person_id random)`, `person_aliases` (email hash, anonymous_id, SSO subject), a restricted `persons_pii` table, and a versioned user_key. Needs an ADR. Fully moving email out of the event tables needs a documented exception to ADR 0005, because it means nulling columns and changing CHECKs. Without that exception we do not claim "crypto-shredding". | None | L | High | Reduces risk |
| Pre-login and anonymous-device stitching | What the person did before SSO completed, new vs returning devices, and people on anonymous apps. | Identify transitions (anonymous_id to person_id) and `device_person` many-to-many for shared terminals. We stitch only when the same session later carries a verified identity, never from the email hint, and we never merge two verified people. | SDK upgrade | M | High | Medium |
| User 360 v2 (person page) | Who this employee is in the org, which apps and features they use, their devices and browsers, the errors and frustration they ran into, their journeys and cohorts, and who has viewed the profile. | `person_stats` (first/last seen per app, sessions, errors, slow requests, primary device and store) and `profile_view_log`. Active time, days-active and lifecycle are not shown by default: only to Support or App owner after they state a purpose, and every view is logged. Risk scores never appear here. The URL uses an opaque person_id. | None | L | Must | High (needs M11 first) |

### M2. Behaviour analytics (insights, funnels, retention, paths, cohorts)

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Metric catalog (semantic layer) | One agreed definition each for active user, engaged session, adoption, eligible headcount and similar metrics, used by every chart, alert, report and AI answer. | Metric definitions in `packages/shared` and on the "how metrics are counted" page. | None | S-M | Must | Low |
| Typed query DSL, scoped | The engine behind trends, funnels, retention and paths. It is not a general SQL replacement. | An `InsightQuery` zod schema in `packages/shared`, compiled to parameterised SQL on the server, plus `saved_insights` with opaque ids. | None | L | Must | Low |
| Insights / trends builder | Any event and metric (totals, uniques, unique stores, per-user average, p50/p95), filtered and broken down by any property, compared with the previous period. | A UI over the DSL. Long ranges read rollups (M12). | None | M | High | Low |
| Funnels with server-verified outcome steps | What % of staff who open stock audit actually get a 2xx on `POST /audit/submit`, where they drop off, how long each step takes, and whether it differs by store or role. | A `FunnelQuery` (steps over page_view, tool_use, custom, autocapture and api_request events; time window; order mode; exclusions) and the list of users who dropped off. This depends on the M6 linking fix and correct route templates (M3). | None | L | Must | Low |
| Retention and cohort tables | Of the people who first used the stock app in week 1, what % still use it in week 4, and which store cohort retains best. | Reads the `person_app_day` rollup. Retention definition: birth event, return event and interval. | None | M | Must | Low |
| Stickiness with a working calendar | How habitual each app or tool is (DAU/MAU, WAU/MAU), and how many people use it on exactly N working days. | `work_calendar` (store or HO, date, working day yes/no, holiday) and a days-active histogram. | External owner (optional): HR supplies holidays | M | High | Low |
| Lifecycle and quick ratio | Whether each app's user base is growing or quietly drifting back to Excel and WhatsApp (new, returning, resurrected, dormant). | Lifecycle counts per interval with drill-down lists, and the quick ratio (new + resurrected) / dormant. | None | M | High | Low |
| Paths / Sankey, including cross-app | Where people go after Reconciliation, what they do just before a 5xx, and whether they jump from sales to the agreement vault. | A `PathQuery` (start/end node, steps, exclusions, path-cleaning rules, minimum users). Replaces the fixed 3-step top paths. Cross-app paths depend on the session-definition decision. | None | L | High | Low |
| Behavioural cohorts and saved segments | Reusable groups such as "North-zone store managers with 3+ audits in 30 days who never used bulk upload", usable in every chart, alert and export. | `cohorts` (definition AST, static or dynamic) and `cohort_members`. | None | L | Must | Low |
| Computed user properties | Audits in the last 30 days, primary store, primary device and last app used, available as filters. | Computed property definitions and values in `person_stats`. | None | M | Medium | Low |
| Engaged sessions, bounce and engagement time | Which sessions were real work (for example more than 10 s visible, 2+ pages, or a key event) and which were accidental opens. | A `sessions.engaged` flag. The definition lives in the metric catalog. | None | S | High | Low |
| Custom-event and props analytics | How often each custom event fires, broken down by label, value or props (stored today, never queried). Also shows the real event name in Live instead of "Custom event". | None (read side only), plus a name on `OnlineUserDto.lastEvent`. | None | S | High | Low |
| Annotations and release markers | Why a metric moved: release v2.3, a GST due date, a Diwali sale, an outage. | `annotations` (manual, release, alert or deploy webhook) and a business calendar. | Wiring (small, optional): set `release` and an optional CI deploy webhook | S | High | Low |
| Search and filter usage (no text) | Whether search is used, the result-count bucket, the zero-result rate, and which filter combinations are popular on data-heavy grids. | A `search` / `filter` event type: field id, result-count bucket and filter keys only, never the search terms. | Wiring (small): `data-nexus-search` or `trackEvent` with a count bucket | M | High | Low |
| Downloads, exports and prints in the browser | Excel downloads, and label or invoice prints per page and tool. This complements M8's server-side view. | A `download` / `print` event (file-extension bucket, tool id, page template). No file names that could contain ids. | SDK upgrade | S | High | Low |

### M3. Autocapture, feature adoption and in-app engagement

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| SDK sends `routeTemplate` | Correct page grouping (no more one page per product id). | `routeTemplate` on browser events (the schema field already exists). The Next.js adapter fills it automatically from `useSelectedLayoutSegments`/`useParams`. React Router apps must pass a `routeTemplate` prop. Server-side guessing stays as the fallback. | SDK upgrade (Next.js). Wiring (small) for React Router and other routers. | S (Next) / M overall | Must | Low |
| Privacy-safe click, change and submit autocapture | Which buttons, links, tabs and filters get clicked on every page, without `data-nexus-tool` markup. | An `autocapture` event: tag, role, `data-nexus-*` attributes only (allow-list), `aria-label` and id/name only if they pass the PII scrubber, and selector segments containing digits or tokens dropped. No `text_hash` (short labels can be reversed with a dictionary), no input values, no copy events on table cells. Static button text only if the element-text decision allows it. Enabled per app via remote config, and piloted on EBO_SALES to measure events per page view before we quote any volume. | SDK upgrade | L | Must | Medium (High if text is enabled) |
| Retroactive virtual events | Define "Submitted GST return" or "Clicked Export" today and see it back to the day autocapture started. | `virtual_events` (match rules, owner, verified, status) with opaque ids. | None | M | High | Low |
| Feature registry, adoption %, time-to-first-use and unused features | What % of active users have used bulk upload, how soon they find it, which features nobody uses, and which are core, power or forgotten. | `features` (rule over tool_use, virtual, custom or route events; owner; release; core flag) and a `feature_adoption` rollup with first-used time. | None | M | Must | Low |
| Event catalog (lexicon) with approval and violations | What each custom event means, who owns it, whether it still fires, and which events are unexpected or malformed. | `event_catalog` (status planned/live/unexpected/hidden/blocked/deprecated, property schema, PII flag) and violation counters. Blocked events are not stored. | None | M | High | Low |
| Zone metrics (`data-nexus-zone`) | Widgets that are seen but not clicked, hesitation before the first click, and filter bars that get ignored. | `zone_exposure` events (visible at least 150 ms) and hover and click counts per view. | None for existing tool markup. Wiring (small, optional) for `data-nexus-zone`. | M | Medium | Low |
| Product Engagement Score (PES) per app and store | One 0-100 health number per app or store (adoption, stickiness, growth), with its components shown. | `pes_daily` with the formula published in an ADR. App and store level only. Store cells follow the minimum-group-size decision. | None | M | Medium | Medium |
| Page titles, masked | Readable page names in Pages, Paths and Live. | `page_view.title`, PII-masked, at most 120 characters. Needs an ADR, because 01-project-overview says page titles are not collected in v1. | SDK upgrade | S | Medium | Medium |

### M4. Frustration, forms and UX signals

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Rage clicks | Buttons that look broken or respond too slowly (3 or more clicks within 30 px and 1 s). | A `rage_click` event (target tool id or scrubbed selector, count, relative x/y, request-in-flight flag). Thresholds live in `packages/shared`. | SDK upgrade | S | Must | Low |
| Dead clicks | Elements that look clickable but do nothing (no DOM change, navigation or network within about 2.5 s). | A `dead_click` event and an ignore list. The MutationObserver cost has to fit the SDK performance budget. | SDK upgrade | M | Must | Low |
| Error clicks and API-error clicks | Clicks followed by a JS error, or by a 4xx/5xx on the same page view. Only Nexus can do the API variant. | A derived flag joining clicks to errors within N ms. Needs the M6 linking fix and a `page_view_id` index. | None | S | High | Low |
| Quick backs (U-turns) | Menus that send people to the wrong page (they go back within about 7 s). | None. Derived from page views and visible time we already have. | None | S | High | Low |
| Scroll depth and excessive scrolling | Whether people reach the bottom of long reports, and who is hunting for something. | `maxScrollPct`, page height and viewport height on `page_time`, plus optional container scroll via `data-nexus-zone`. | SDK upgrade | S | High | Low |
| Field-level form analytics (never values) | Which field in the GST, recon or audit form causes hesitation, refills, validation errors or abandonment, and whether the submit really succeeded (via the matching 2xx server event). | Form events: form id, field name and type, focus/blur/change counts, time in field, refill count, invalid count, blank-on-submit, value-length bucket. Field names containing digits are dropped (names go through an allow-list). Needs an ADR. | SDK upgrade. Wiring (small, optional): `data-nexus-form` for SPA pseudo-forms. | L | High | Medium |
| Form abandonment | Who started a form and never submitted it successfully, the last field they touched, and whether they finished later. | Derived `form_session` rows. | None | M | High | Low |
| Active vs idle time | Real working time vs a tab left open, per app and flow. | `activeMs` on `page_time` (whether there was interaction in each 5 s bucket, never which keys). Shown in aggregate only by default. It is never a per-employee leaderboard. | SDK upgrade | S | High | Medium |
| Click heatmaps and scroll maps | Where people click on each page (all, dead, rage or error clicks) and how far down they get, by device, role or release. | Heatmap aggregates per route, element and viewport bucket. The default background is a wireframe of element boxes. A masked DOM snapshot background is allowed only under the replay ADR. | SDK upgrade | L | High | Medium |
| Session frustration score, issue clustering and employee-minutes lost | Which sessions engineers should look at first, and which issues (signal, route and element) hurt the most people, ranked by minutes lost against the median flow. | `sessions.frustration_score` (formula published in an ADR) and `ux_issues` (affected users and sessions, first/last seen, release introduced, state). Presented as app quality, never as employee performance. | None | M | Must | Medium |
| "Report a problem" button | One click that hands support the exact session and page view. | A `problem_report` event (session id, page view id, category). No free text by default. Ticketing goes through M9. | SDK upgrade + Wiring (small): opt-in flag, because it renders UI inside their app | M | High | Low |

### M5. Session replay (privacy-first, gated by decision)

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| rrweb DOM recorder, private by default | What exactly happened on screen before a 500, a rage click or a support ticket. | rrweb snapshots and mutations with all text masked and inputs blocked. Attributes are scrubbed too: query stripped from href/src, and title, alt, placeholder, `data-*` and canvas/SVG text dropped. Per-app policy (strict, balanced or relaxed) and `data-nexus-block`/`mask`/`unmask`. We pin an exact rrweb version and review it: the `@rrweb/record` v2 line is still alpha, and the licence is MIT. Needs remote config (M0). | SDK upgrade + Wiring (small): mark sensitive regions with `data-nexus-block` | XL | High | High |
| Chunked replay uploader, ingest and object storage | Keeps replays cheap, seekable and auto-expiring without bloating Postgres. | A separate chunked uploader with back-pressure (snapshots of data-heavy grids reach MBs and cannot use the 60 KiB beacon path). A `/v1/ingest/replay` route, nginx body limits, a buffered writer, MinIO/S3 blobs and `replay_sessions` metadata (record_reason, size, retention). Needs ADRs on infrastructure and the ingest buffer. | None | L (+ infra) | High | Medium |
| Sampling, buffer-on-error and triggered recording | Records only what matters (error, rage click, 5xx, opted-in support case), which limits both cost and surveillance. | Per-app sample rates, on-error rate, buffer window, triggers and minimum duration. `record_reason` is stored on every replay. | None (remote config) | M | High | Medium |
| Replay player synced with the Journeys timeline | Watch the session together with page views, tools, frustration markers, JS errors and the linked server events, with idle stretches skipped. | Timeline markers, timestamp deep links and pinned replays. IPs stay admin-only. | None | L | Must (if replay is approved) | Medium |
| Replay governance | Who watched whose replay, for how long and why, and which roles and pages are never recorded. | `replay_view_log` with purpose, exclusion lists, an unmask approval log and a Replay-viewer role. | None | M | Must (if replay is approved) | Reduces risk |

### M6. Performance, frontend errors, reliability and release health (RUM)

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Fix browser-to-server linking | Every API call joined to its page view and session (today 64% of stockapp and 29% of ebo-sales calls are unlinked). | None (the existing X-Nexus headers). The SDK adds an XHR/axios patch and an `@nexus/react/early` entry that installs the patch before app clients load. Integration health gets a per-app linking-coverage check that names the callers that fail. | Wiring (small): set `propagateHeaders: true` (it defaults to false), import `@nexus/react/early` first in the entry file, and add X-Nexus-* to their CORS if the API is on another origin | S (ours) + small per app | Must | Low |
| W3C `traceparent` correlation | For one click: browser wait vs network vs server time, and the exact server event it caused. | `trace_id`, `span_id` and `parent_span_id` on `api_requests`, plus a browser fetch span. Same-origin only by default. Cross-origin calls need an allow-list option (like Datadog's `allowedTracingUrls`). | SDK upgrade. Wiring (small) for cross-origin: their API's CORS must allow `traceparent`. | M | High | Low |
| Core Web Vitals with attribution | p75 LCP, INP, CLS, FCP and TTFB per landing screen, plus which element or script is to blame. These measure the hard page load only. On SPAs, route-change timing is the per-screen metric. | A `web_vital` event (name, value, rating, attribution: selector without text, INP sub-parts, LCP sub-parts). Uses the Apache-2.0 web-vitals library. | SDK upgrade | M | High | Low |
| Route-change timing and navigation waterfall | How long each in-app route change takes to settle, and why the first load is slow (DNS, TLS, TTFB, DOM). | `loadMs`/`settleMs` and navigation timing deltas on `page_view`. | SDK upgrade | M | Must | Low |
| Failed and slow browser requests | API calls that failed from the user's side (network error, timeout, abort, CORS, proxy 502) even when the server never logged them. | A `net` event (method, path without query, template, status including 0, duration, failure kind, size, trace id). | SDK upgrade | M | Must | Low |
| Sampled resource timing and Long Animation Frames | Heavy bundles, uncached assets, render-blocking CSS, and the script that froze "Save" for 800 ms. | The top N slow resources per view, and LoAF frames over 100 ms with their top 3 scripts. Queries are stripped from URLs and `chrome-extension://` sources are dropped, so we don't reveal which extensions an employee uses. | SDK upgrade | M | Medium | Low |
| Device and network context | Whether warehouse tablets on slow networks or old Chrome are the slow ones, and which screen sizes stores use. | Once per session: effectiveType, rtt and downlink buckets, deviceMemory, cores, viewport/screen bucket, DPR and UA-CH platform. These are Chromium-only, so Safari and Firefox report "unknown" and the UI shows that share. Values are bucketed to avoid fingerprinting. | SDK upgrade | S | Medium | Low |
| Frontend JS error capture | What crashes in the UI, for whom, on which screen and release, including errors that never reach the API. | An `error` event (type, fingerprint, stack frames with queries stripped and extension frames dropped, handled flag, mechanism) and, if the decision allows, a scrubbed message template with short retention. An `error_events` table. The ADR must amend CLAUDE.md rule 6 and the error-message DB rule. | SDK upgrade. Wiring (small, optional): `NexusErrorBoundary` | M | Must | Medium |
| Source map upload and symbolication | Readable stack traces and correct grouping on minified code. Without source maps, grouping stays weak. | `sourcemaps` (app, release, debug id, blob in object storage). The source-map library is BSD-licensed. | Wiring: a CI step or bundler plugin snippet from the guide | L | High | Low |
| Unified Issues inbox | One short list of distinct problems (server error codes, frontend fingerprints, UX issues) with first/last seen, affected users and stores, release introduced, status and assignee. | `issues` (fingerprint, kind, counts, status unresolved/resolved/ignored/regressed, assignee). | None | L | Must | Low |
| Breadcrumbs on errors | What the user and app did in the last 50 steps before the error. | Mostly derived server-side from Journeys, plus a small client ring buffer: tool ids, selectors, routes and request summaries only, never text or console messages. | SDK upgrade | S | High | Medium |
| Release health and regression detection | Whether yesterday's deploy made things worse: crash-free sessions and users per release, adoption %, new or regressed issues, latency and vitals deltas. | `release` on browser events, `deploys`, a `release_health` rollup, and a per-app "release set?" status on Integration health. Browser events carry no release today, and on the server it is a manual option. | Wiring (small): set the `release` prop or build env variable on browser and server. Optional CI deploy webhook. | M | High | Low |
| Apdex / UX score per app and route | One satisfaction number per app and route, computable today from server events. | `apdex_thresholds` (app, route, T). | None | S | High | Low |
| Click-to-settled action latency | How long from clicking "Run reconciliation" until the result shows, including all API calls. | Action timing on tool and autocapture clicks (loading ms, child trace ids, long tasks) and an optional `startAction`/`endAction` API. | SDK upgrade. Manual API optional. | M | High | Low |
| Server-Timing / Timing-Allow-Origin | DB time vs app time inside the browser waterfall. | `serverTiming` entries on resource events. | SDK upgrade (server middleware sets the headers) | S | Medium | Low |
| Custom performance marks (`nexus:` prefix) | "Stock grid rendered" or "recon table ready" timings that LCP misses. | Mark and measure events with an allow-listed prefix. | Wiring (small): `performance.mark('nexus:...')` | S | Medium | Low |
| Outbound dependency monitoring (new) | Calls from the app servers to ERP/SAP, GSTN or e-invoice portals, payment and bank APIs: latency, failure codes, which app and route. This is where finance and GST apps actually break. | A `dependency` server event (target host, path template, method, status/error code, duration). No query strings or bodies. | SDK upgrade (server). Wiring (small): name the dependencies. | M | High | Low |
| Background job and cron observability (new) | Long reports and jobs (for example style-kpis at 131 s), failures, missed runs and queue lag, as first-class events. | A `job` server event (job name, start, duration, outcome code, items-count bucket). | Wiring (small): wrap jobs with `nexus.job(name, fn)` | M | High | Low |
| Synthetic uptime checks and internal status page (new) | Whether an app is down before stores open, even when nobody is using it, and an "is the stock app down?" page that employees can check. | `synthetic_checks` (URL or route, schedule, expected status, latency) and an internal status page. | External owner: a test account if we probe a page behind login. Otherwise none. | M | High | Low |

### M7. Workforce adoption and org intelligence

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Adoption by department, store, role, region and manager team | Which regions lag on stock audit, and adoption % (active people divided by eligible headcount). Store adoption is also shown as "stores with at least 1 active user / eligible stores". Minimum group sizes depend on the audience (see the decisions). Every view shows its suppression rate. At 38 verified users most store cells would be suppressed today, so the feature waits for identity-coverage targets. | A `group_day` rollup (group, app, date, active people, feature breadth) and eligible headcount from `employee_dim`. | External owner (directory) | M | Must | Medium |
| Seat and access utilisation | Of the people granted finance-recon access, how many used it this month, and which accesses the quarterly review can revoke. | `entitlements` (person, app, role, granted at) and engagement bands (low under 25%, medium 25-50%, high over 50% of days active). The custom portal JWT may hold no app-assignment data, so CSV is the default source. | External owner: the portal team or IT supplies an assignments export | M | High | Low |
| Account hygiene | Ex-employees still using the agreement vault, people who changed department but still use old access, and accounts dormant for 180 days. | Derived flags on `person_stats` (dormant, new, active after exit, role mismatch). | External owner: HR exit dates and moves | M | High | Medium |
| Process mining on business cases (`case_id`) | End-to-end time of a stock audit or GST reconciliation, waits between steps, rework loops, handoffs between roles, SLA breaches. | `case_id` (an opaque internal id, validated so it can never be a GSTIN or PAN) and an activity name in custom-event props. A derived `process_cases` table. | Wiring: `trackEvent('audit.count_submitted', {case_id})` at key steps | L | High | Medium |
| Training needs and time-to-proficiency | Which new store managers need stock-app training, and whether training cut errors and task time. | Task time and error rate against role peers, features peers use that this group doesn't, days to proficiency. Team or store level by default, shown to L&D. | None | L | Medium | Medium |
| At-risk stores and apps | Which stores are quietly going back to Excel or WhatsApp (last-7-day vs last-28-day drop, days since last active). | `at_risk` flags with a rule-based reason. Sent to app owners, never to HR. | None | M | High | Medium |
| Store and department scorecard, executive adoption score | For leadership: whether each app is paying off, and which stores need attention (activation, core-feature coverage, errors, frustration). | `health_score_daily` with the formula published. | None | M | High | Low |
| Working-hours and activity-rhythm heatmap | Peak hours per app and store, the 11 pm month-end GST rush, and safe maintenance windows. | Active minutes by hour and weekday (IST) per group, aggregate only, with the leadership-level minimum group size. Never an individual after-hours view. | None | S | Medium | High |
| Business-outcome linkage (new) | Whether tool adoption improves the business: store adoption against sales, shrinkage, audit accuracy and GST filed on time. | `store_kpi_monthly` imported from ERP/BI, store-level only, plus correlation views that show N. | External owner: an ERP/BI export | L | High | Medium |
| Cost of friction and ROI in INR and hours (new) | Employee-minutes lost multiplied by loaded cost per role band, and hours saved against the Excel baseline. This is what leadership asks for. | `role_cost_band` (INR/hour per band, from HR/finance) and derived ROI views, aggregates only. | External owner: cost bands from HR/finance | M | High | Low |

### M8. Audit trail, security and anomalies

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Office and store network map, plus the real client IP | Whether activity comes from a store, warehouse, HO or VPN. This fixes the empty Geography page. | `network_locations` (CIDR, kind, store code) and `ip_location_kind` on events, resolved before the IP is anonymised. | External owner: IT supplies the CIDR list and makes the proxy forward X-Forwarded-For. Wiring (small): set the correct `trust_proxy_hops`. | S | Must | Low |
| Route sensitivity registry | Who called export, delete, approve or admin endpoints, and how often, without any app code. | `route_sensitivity` (app, method, template, class), seeded by template heuristics and edited in the dashboard. | None | S | High | Low |
| Sensitive-action audit API (`nexus.audit()`) | Who approved this variance, exported the vendor list or deleted an agreement, with what result, from which location. | `audit_events` (actor, role at the time, action verb.noun enum, target type and opaque id, result code, reason code, row count, request id). Append-only: UPDATE and DELETE revoked from the API role, with optional periodic signed exports of the table head. No hash chain, because it needs a serialised writer and breaks on partition drop. It gets its own retention class. Each app defines its own action taxonomy. | Wiring: an `audit()` call at each action point, with each app deciding what counts as an approval | L | High | Medium |
| Mass export and bulk access detection | Whether someone exported far more than usual, or outside working hours. | Per-person baselines of export request counts and audit row counts. Not bytes: `response_bytes` comes from Content-Length, and streamed or chunked exports leave it empty. A byte counter wrapping `res.write` is an optional server SDK upgrade. The notice-period flag is available only to the Security investigator, with a written justification. | None. SDK upgrade for byte counting. | M | High | Medium |
| Privileged and admin activity | Role grants, self-elevation, user creation, config changes and impersonation inside internal apps. | Audit actions such as `permission.granted/revoked`, `impersonation.*` and `settings.changed`. | Wiring (via the audit API) | M | High | Low |
| Failed-auth analytics (401/403) | Repeated auth failures per user or location, and stores with chronic login trouble. | None. Derived from server status codes. | None | S | Medium | Low |
| SSO sign-in log | Login success rate and failed sign-ins by store, and which apps people actually log into. | `sign_ins` (time, person, app, result code, location kind). Only possible if the custom portal keeps a login log and exposes it. | External owner: the portal team | M | Medium | Medium |
| Device and browser inventory | How many store tablets run outdated Chrome, and which shared devices serve many users. | `devices` (anonymous_id, type, OS and browser version, first/last seen, user count). Uses a random first-party id, never a fingerprint. | None | S | Medium | Low |
| New device / new network flags (deferred) | Whether a finance user's session comes from a device or network we have never seen for them. | First-seen device and location-kind sets per person. Of limited use while all IPs are private. | None | M | Medium | Medium |
| UEBA peer baselines and risk score (deferred) | Whether an action, volume or location is normal for this person and their role peers. | First-seen sets, peer baselines and a risk score. We build this only when the security team asks for it, and only under the Security investigator role with legal sign-off. | None | L | Medium | High |
| SIEM / webhook export (deferred) | Stream audit and security events into the company SIEM. | `log_streams` (destination, format JSON/CEF), masked emails only. Waits until a SIEM is named. | None | M | Low | Medium |

### M9. Alerts, reports, SLOs and dashboards

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| App-silent (heartbeat) alert, business-hours aware | Whether a deploy broke the Nexus middleware or SDK in an app (server or browser side has gone quiet). | Active hours per app and a `no_data` rule type, read from `ingest_counters`. | None | S | Must | Low |
| Threshold alert rules | Messages like "GST tracker 5xx above 2% or p95 above 5 s for 10 minutes". | `alert_rules` (metric from the catalog or DSL, operator, interval, pending period, severity, owner, app scope) and `alert_instances`. Rule enums live in `packages/shared`. | None | M | Must | Low |
| Error spike and new-error-type alerts | What started failing in the last 15 minutes and for how many people, plus never-seen error codes, routes or statuses and regressions. | `error_fingerprints` (app, template, status, error code, first/last seen, first release). | None | M | Must | Low |
| Latency regression and performance budgets | Which route got slow after Tuesday, ranked by how many users it hit (for example style-kpis p95 at 131 s). | Route budgets and week-over-week deltas using exact percentiles. | None | M | High | Low |
| Simple anomaly checks | Whether today is abnormal compared with the same weekday in recent weeks. | Week-over-week and same-weekday comparisons with a holiday calendar. Seasonal MAD bands are parked until there is enough volume and history. | None | S-M | Medium | Low |
| Alert lifecycle | Useful alerts instead of noise: pending, firing and recovered states, grouping, silences, maintenance windows, acknowledgement, history. | Notification policies, silences, mute windows and acknowledgements. | None | M | Must | Low |
| Notification channels | Alerts land where owners actually read them. | `contact_points`: email, Teams through a Workflows webhook (Office 365 connectors are retired) or Google Chat, a generic webhook and an in-app bell. WhatsApp comes later. No full emails or IPs in message bodies, only a link back to Nexus behind SSO. | None | M | Must | Medium |
| SLOs, error budgets and burn-rate alerts | Whether GST filing APIs meet 99.5% success under 1 s over 28 days, and how much budget is left. | `slos` (SLI, target, window), per-minute good and total counters, and multi-window burn-rate rules. | None | M | High | Low |
| Scheduled digests and reports | A Monday 9 am adoption PDF per app owner, a monthly department report, a leadership summary. | `subscriptions` (recipients, channel, cron, Asia/Kolkata, filters, skip-if-empty). Reports render with the recipient's permissions. Attachments carry aggregates only. | None | M | High | Medium |
| Curated persona dashboards (new) | Ready-made boards for the owner, app owner, leadership, store or area manager, support and security. | Curated board definitions per persona. | None | M | Must | Medium |
| Saved views and share links | Reopen or share a filtered view without rebuilding it. | `saved_views` (page, filters), with opaque ids only in URLs. | None | S-M | High | Medium |
| Free-form dashboard builder (later) | App owners compose their own boards. | `dashboards` (layout, widgets over the DSL). This is a later decision. | None | L | Medium | Medium |
| Totals endpoints and audited CSV/XLSX export | Full lists instead of the top N, and data handed to finance or BI. | Totals endpoints and `export_log` (who, dataset, rows, when). Emails are masked unless the role has PII permission. IPs stay admin-only. | None | S-M | High | High |
| Change and incident timeline | What changed just before this (deploys, alerts, ingest gaps, annotations). | `incidents` (start, end, severity, affected apps and users, linked alerts, notes). | None | M | Medium | Low |
| Default alert pack per app | Every new app gets heartbeat, error-spike, p95 and SLO alerts with no setup. | Alert templates. | None | S | Medium | Low |
| Ticketing integration (new) | Create a Jira, Freshservice or GLPI ticket from an issue, alert or "Report a problem" click, with the session link attached. | `ticket_links` (issue or alert to ticket id, status sync). | External owner: access to the ticketing tool | M | Medium | Low |
| Hindi/English digests and alerts (new) | Store and area managers read alerts and digests in their own language. | Message templates per locale. | None | S-M | Medium | Low |

### M10. AI insights

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Deterministic root-cause analysis (no LLM) | Which app, route, release, store, role, browser or network contributed most to a drop or spike. | Contribution-analysis results per alert or chart, computed in SQL over rollups. | None | M | High | Low |
| AI governance | What employee data may go to an LLM, to which provider, and at what cost. | `ai_settings` (org switch, provider and region, redaction rules, token budget) and `ai_usage_log`. Needs an ADR for any external processor. | None | M | Must (if any LLM) | Reduces risk |
| Ask Nexus (natural language to the DSL) | Questions like "How many store employees used stock audit last week, by region?" return a chart plus a query you can inspect. | `ai_conversations` (question, generated DSL, feedback), grounded on the metric catalog. Runs with the asker's permissions. No raw SQL. | None | L | High | High |
| AI session summaries from the masked text timeline | What the user was trying to do, where they struggled and what broke, with timestamp links. | `session_summaries` (summary, outcome, key moments, model, PII checked). Assistive only. | None | M | Medium | High |
| AI-written weekly digest | Five bullets per app owner on what changed this week. | Digest narratives built from aggregates only. | None | S | Medium | Medium |

### M11. Governance, RBAC and privacy

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Role model with per-app scoping | Whether the finance team can see who uses the agreement vault (by default, no). Roles: Org admin, App owner, Analyst, Viewer (aggregate), Support, Security investigator, Replay viewer, Auditor. | `roles` and `grants` (role or person, app, resource, level). Roles are managed in Nexus. SSO group mapping happens only if the portal exposes groups. Needs an ADR replacing ADR 0001's viewer/admin access. | External owner (optional): portal groups | L | Must | Reduces risk |
| Postgres row-level security on `app_id` | Guarantees that exports, AI, reports and shared links cannot bypass app scoping. | RLS policies with a transaction wrapper in the repository layer (`SET LOCAL`, which is safe with pooled connections), a separate non-owner query role and `FORCE ROW LEVEL SECURITY`. Role permissions on the external DB must be confirmed first. | None | L | Must | Reduces risk |
| Column-level PII masking by role | Who sees full email, name, IP and location, and who sees masked or pseudonymous ids. | PII permission flags per role, applied in the mappers. | None | S | Must | Reduces risk |
| Access audit log | Who looked at whose profile, journey or replay, who exported what, and who changed roles or alerts, and why. | `access_audit` (actor, action, target, purpose, time). | None | M | Must | Reduces risk |
| Audience-based minimum group size | Stops people being identified through small store or department slices, while app owners can still work. | `MIN_GROUP_SIZE` per audience in `packages/shared` (for example 1 for app owners and support with purpose logging, at least 5 for leadership and HR aggregates) and suppression flags with suppression rate in the DTOs. | None | S | Must | Reduces risk |
| Monitoring notice and "What Nexus collects" page | What is collected, from which apps, why, who can see it, for how long, and the grievance contact. | Purpose tags per data category, and a page generated from the enums in `packages/shared`. Content from HR/legal. | External owner: HR/legal text | S | Must | Reduces risk |
| "My data in Nexus" self-view and request workflow (new) | Employees can see what Nexus holds about them and raise access, correction or grievance requests. A trust choice: DPDP access and erasure rights mainly cover consent-based processing, so legal should confirm. | A self-view page, `data_requests`, a grievance workflow and a breach-notification runbook. | None | M | Medium | Low |
| Exclusion lists and per-feature opt-outs | Leave HR, leadership, specific pages or groups out of replay, autocapture or individual views. | `exclusions` (scope person, group, app or route, plus features). Needs the M0 remote config. | None | S (+ M0) | High | Reduces risk |
| Offboarding erasure and retention purge | Delete or anonymise everything about a person across events, sessions, rollups and blobs, with proof. This is a retention and offboarding tool, not a crypto-shredding guarantee. | `erasure_requests` (subject, reason, due date, per-store result) and a legal-hold flag, carried out as a transactional delete/update by `person_id`. | None | M | High | Reduces risk |
| Retention per data class | Raw events, rollups, replays, audit, errors and quarantine each kept for a documented period. Includes checking a possible 1-year floor under DPDP Rules 6 and 8(3). | `retention_policies` (class, period, legal basis), enforced by partition drop and object lifecycle rules. Needs an ADR replacing the single `RAW_RETENTION_MONTHS`. | None | M | Must | Reduces risk |
| Security of Nexus itself (new) | Nexus becomes the most sensitive employee dataset in the company, so it needs to be protected like one. | Encryption at rest, backup and restore drills, rotation of `USER_KEY_SECRET` and keys (versioned), DPIA and DPO sign-off, and a breach runbook. | External owner: DB host/IT for encryption and backups | M | Must | Reduces risk |

### M12. Data platform

| Feature | Kya pata chalega (questions answered) | Naya data | App team ka kaam | Effort | Value | Privacy risk |
|---|---|---|---|---|---|---|
| Indexes and query hygiene | Keeps drill-downs under 300 ms as data grows. | A `page_view_id` index on `api_requests` and BRIN indexes on `occurred_at`. | None | S | High | Low |
| Sessions table, upserted incrementally | Journeys, entry and exit, bounce, duration, error-hit sessions, frustration score and replay availability without scanning raw tables. | `sessions` (person, apps, start/end, visible and active ms, entry/exit template, counts, errors, device, location, frustration, replay flag). Needs an ADR, and the session-definition decision. | None | M | Must | Medium |
| Rollups with exact counts | Year-over-year trends and fast dashboards beyond 93 days, and the base for retention, stickiness, lifecycle and PES. | `route_hour`, `page_day`, `tool_day`, `person_app_day` and `group_day` with exact `COUNT DISTINCT` and percentiles (HLL and t-digest are not needed at this volume), plus watermarks. Needs an ADR. | None | L | Must | Low |
| Rollup rebuild and backfill (new) | Keeps numbers correct when the directory, virtual events or feature definitions change after the fact. | Rebuild jobs by date range and a definition version on rollup rows. | None | M | High | Low |
| Rejected-event quarantine (reason only) | Why ebo-kpiverse browser ingest rejected events, and which field failed validation. | `ingest_rejections` (app, SDK version, failure type, schema path, count per hour). Payloads are never stored. | None | M | High | Low |
| Exact live presence | An accurate "who's online" beyond 100 people, and correct `activeUsers` on past ticks. | In-memory presence with a 60-90 s TTL and per-minute counters, on a single node. Redis only if the API runs on several nodes. | None | S-M | Medium | Medium |
| Pipeline observability and capacity triggers | Ingest-to-queryable lag, rollup lag, outdated SDKs, storage growth, and when to revisit the engine. | `/metrics` and a capacity panel on Integration health. | None | S | Medium | Low |
| Ingest buffer (only with replay or high volume) | Makes sure replay or autocapture volume, or a DB stall, never drops events or slows host apps. | An in-process buffer with batched COPY, plus lag and depth metrics. Needs an ADR. Built only when replay is approved or the autocapture pilot shows the need. | None | M | Medium | Low |
| Object storage (MinIO/S3), only if needed | A home for replays, source maps and report PDFs, with lifecycle expiry kept in step with the metadata. | Buckets with lifecycle rules and blob metadata tables. Needs an infrastructure ADR. | External owner: IT provisions it on the host | M | Medium | Medium |

### Not building or parked (owner to confirm)

| Item | Reason |
|---|---|
| In-app guides and checklists (M3) | A separate digital-adoption product that renders UI inside other teams' apps (hard rule 1). |
| Feature flags and experiments (M3) | XL scope with little need for internal apps. Teams can report variants through `trackEvent` if they ever need it. |
| In-app CSAT/eNPS surveys (M3) | Revisit score-only surveys after Phase 4. Free text conflicts with the "no typed text" rule, and the widget needs CSP opt-in from each app. |
| Thrashed cursor (M4) | A niche signal that costs CPU on store tablets. |
| Live co-browse (M5) | Needs consent UI inside other apps and carries the highest privacy risk. |
| Browser Reporting API (M6) | The browser sends reports without our envelope, which breaks the key model. Low value. |
| JS self-profiling (M6) | Needs a Document-Policy header from each app. Niche. |
| Shadow-app discovery extension (M7) | Needs MDM deployment, sits outside the SDK model, and is very intrusive. |
| Impossible travel (M8) | Not possible while all IPs are private. |
| Engagement correlation / "aha" analysis (M2) | Statistically meaningless with about 38 users. |
| Forecasting and seasonal anomaly bands (M9) | Too little volume and history. Simple week-over-week checks are enough for now. |
| AI alert investigation agent, MCP server (M10) | Revisit after Ask Nexus proves accurate. |
| HLL and t-digest sketches (M12) | Exact SQL is fine at this volume for years. |
| Parquet archive and BI warehouse export (M12) | Wait until BI asks. Archives must follow the same retention and erasure rules. |
| OTLP intake (M12) | No current producer of OpenTelemetry data. |
| TimescaleDB, ClickHouse, self-hosting PostHog or OpenReplay | See Architecture options. |

## Architecture options

| Option | Pros | Cons | When to choose | Recommendation |
|---|---|---|---|---|
| A. PostgreSQL (monthly partitions) with exact rollups, a sessions table and BRIN indexes | No new database to run. Fits the repositories, migrations, parity tests and ADR 0002. ~28k rows/30 days is tiny. Easiest place for joins with the directory, RLS and erasure. | Long ad-hoc funnels and paths over raw ranges slow down above roughly 100M rows/month. No columnar compression. | Now. | **Recommended baseline.** Revisit when a 90-day raw-scan p95 goes above 3 s or volume goes above 100M rows/month. |
| B. TimescaleDB extension on the same Postgres | Same SQL and drivers, compression, continuous aggregates. | Needs extension rights on the external DB host. TSL licence review. Migrating partitioned tables to hypertables. | Only when A's trigger fires and the host allows the extension. | Not now. Keep one line in the ADR. |
| C. ClickHouse sidecar for high-volume events | Very fast scans, built-in funnel and retention functions. | A second database to run and back up. Erasure is expensive. RLS and PII rules have to be rebuilt. Overkill for 7 apps. | Above roughly 1B rows/month. | Not now. Keep it behind the repository layer so it stays a local swap. |
| D. Object storage (MinIO on-prem or S3) | The right home for replays, source maps and PDFs. Cheap, with lifecycle expiry. | New infrastructure on the single host (ADR 0004), backups, orphan risk between metadata and blobs, signed URLs behind RBAC. | Only when replay or source maps are approved. | Conditional. Combine with A. |
| E. Ingest write path: synchronous vs in-process buffer vs Redis Streams or NATS | Synchronous is what we have and is simplest. An in-process buffer with COPY handles bursts. Redis or NATS add durability and multi-node support. | Any buffer changes ADR 0001's guarantee, and an in-process buffer can lose one batch on a crash. Redis and NATS are more infrastructure. | Buffer only with replay, or if the autocapture pilot shows more than about 200 events/s. | Stay synchronous now. In-process buffer later if needed. No Redis or NATS. |
| F. Self-host a full OSS product (PostHog or OpenReplay) next to Nexus | Gets replay, heatmaps and funnels quickly. | Two competing products, a heavy stack (ClickHouse, Kafka, Redis, 16 GB+), no knowledge of SSO trust levels, stores or departments, and it breaks the `packages/shared` contract and the PII rules. | Never, unless co-browse becomes a hard requirement. | Not recommended. Embed libraries instead (rrweb MIT, web-vitals Apache-2.0, source-map BSD). |
| G. Live presence: in-memory vs Redis | In-memory is exact and has no infrastructure on a single API node. | In-memory does not survive restarts or scale across nodes. | Redis only if the API runs on several nodes. | In-memory. |
| H. Remote config delivery | Served by the Nexus API from Postgres: signed, ETag-cached, versioned, fail-closed. No new infrastructure. | Config mistakes reach every app at once, so it needs versioning and rollback. | Before any new capture ships. | **Recommended** (an M0 prerequisite). |
| I. Distinct counts and percentiles: exact SQL vs sketches | Exact is simple and correct. Sketches merge cheaply. | Sketches need extensions (hll, tdigest) that may not be allowed, and add complexity. | Sketches only above about 100M rows/month. | Exact. |
| J. SDK distribution: versioned vendoring vs private npm registry | Vendoring needs no infrastructure. A registry makes upgrades one command and gives a clear version history. | Vendoring upgrades are slow and manual. A registry is a small piece of infrastructure, and teams switch their install once. | Registry when more than 3 apps need frequent SDK releases, which the roadmap implies. | Registry (decision 18). |

## Phased roadmap

These durations are developer-weeks. The calendar figures assume about 2 developers, and the owner must confirm real capacity (decision 2). Every SDK-dependent feature also waits for app teams to upgrade. We track that on Integration health with a per-app SDK version target and plan for 2 to 6 weeks of adoption lag per release.

**Phase 0: Decisions, charter and legal gate (1-2 weeks calendar)**
- The owner answers the decisions below.
- HR/legal start the DPIA and draft the monitoring notice.
- ADRs:
  - 0008: product scope and privacy charter.
  - 0009: sessions table, rollups and retention classes.
  - 0010: identity model (directory, `person_id` re-key, traits, account types).
  - 0011: SDK remote config and kill switch.
  - Later: error capture (amends CLAUDE.md rule 6), autocapture text and attributes, replay (attribute scrubbing, infrastructure, buffer), and AI processors.
- A read-only check of the portal JWT payload to see which claims exist.

**Phase 1: Data quality and SDK safety (about 8-12 dev-weeks, one SDK release)**
- **SDK:**
  - `routeTemplate` (automatic for Next.js, a prop for React Router).
  - XHR/axios patch and the `@nexus/react/early` entry.
  - The `release` prop and `environment` field.
  - Persistent retry queue, debug mode and staging key.
  - Remote config and kill switch.
  - Performance budget in CI.
  - Download and print events.
- **Ingest:**
  - PII leak detector.
  - `tz`/`lang` columns.
  - Rejected-event quarantine (reason only).
  - Internal-traffic flags.
  - Privacy regression tests.
- **Read side:**
  - Browser, OS, device, release, referrer and anonymous-device breakdowns.
  - Unverified activity on Users and Apps.
  - Custom-event view.
  - Totals endpoints.
  - `page_view_id` and BRIN indexes.
  - Apdex and U-turns.
- **Integration health:**
  - Identity-coverage KPI and integration-level badge.
  - Linking coverage with the failing callers named.
  - SDK version matrix.
  - "Release set?" status.
- **Identity:** an identity-coverage push (the SSO-cookie path for all apps, and `getUser` guidance for ebo-kpiverse, finance-recon and finance-tool).
- **Location:** the subnet-to-store/office map from IT.
- **Alerts:** a heartbeat alert by email or Teams.
- **Why first:** it fixes the gaps that would poison every advanced feature (wrong templates, unlinked calls, empty location, no identity), and it ships the kill switch before we capture anything new.

**Phase 2a: Identity and org (about 8-10 dev-weeks)**
- Employee and store directory as SCD2, CSV first, then an HRMS/IdP API if one exists.
- `account_type` and shared-login handling.
- Org joins at query and rollup time.
- `person_id` re-key, aliases and secret rotation.
- `getUserTraits`.
- Anonymous-device stitching.

**Phase 2b: Governance (about 10-14 dev-weeks)**
- Role model and per-app scoping, RLS (transaction wrapper, non-owner role, FORCE), PII masking by role and the access audit log.
- Audience-based minimum group sizes and exclusion lists.
- Notice and "What Nexus collects" page, retention classes and the offboarding purge.
- Security of Nexus (encryption, backups, key rotation, breach runbook).
- **Compliance milestone:** most DPDP Rules 2025 obligations start about 18 months after the 13 Nov 2025 notification, so around May 2027. Retention floors, security safeguards, the breach runbook and log retention must be live before then. That puts Phase 2b on the critical path.

**Phase 2c: Platform (about 8-10 dev-weeks)**
- Sessions table.
- Exact rollups (`person_app_day`, `group_day`, `route_hour`, `page_day`, `tool_day`) and the rebuild/backfill job.
- Exact live presence.
- Pipeline observability.

**Phase 3: Analytics core, User 360 and adoption (about 20-28 dev-weeks)**
- **Analytics:**
  - Metric catalog and the scoped DSL.
  - Trends.
  - Funnels with server-outcome steps.
  - Retention, stickiness with a working calendar, lifecycle.
  - Paths (cross-app per the session decision).
  - Cohorts, engaged sessions, annotations, search/filter analytics.
- **Users:** User 360 v2, purpose-gated.
- **Org and business:**
  - Adoption by store, department and role, with suppression rates.
  - Seat utilisation and account hygiene (if HR and the portal supply data).
  - At-risk stores and the store scorecard.
  - Cost of friction.
- **Dashboards:** curated persona dashboards, saved views and audited CSV export.
- **Reports:** weekly digests.
- **Why:** it answers the owner's complaint ("user monitoring is weak") directly, with the highest value for the privacy risk taken.

**Phase 4: Reliability, RUM and alerting (about 20-26 dev-weeks)**
- **Correlation and performance:**
  - `traceparent`, same-origin first.
  - Route-change and navigation timing.
  - Web Vitals (hard loads).
  - Failed and slow browser requests.
  - Device and network context.
  - Action latency.
  - Server-Timing.
- **Errors and releases:**
  - JS errors (per the error ADR).
  - Source-map snippet.
  - Issues inbox.
  - Release health.
- **Server-side reach:**
  - Outbound dependency monitoring.
  - Job and cron observability.
  - Synthetic checks and status page.
- **Frustration:** rage, dead and error clicks, scroll depth, active time (aggregate), frustration score and minutes lost.
- **Alerting:**
  - Threshold, error-spike and new-error-type alerts.
  - Latency regression and simple anomaly checks.
  - Alert lifecycle and channels.
  - SLOs and burn rate.
  - Default alert pack, ticketing integration and Hindi/English templates.
- **Why:** it moves Nexus from showing logs to telling owners what broke. The known slow routes (style-kpis at 131 s, filters/options at 31 s) give immediate value.

**Phase 5: Autocapture, forms, features and audit (about 18-24 dev-weeks)**
- **Capture:**
  - Autocapture: pilot on EBO_SALES, measure volume, then roll out per app via remote config.
  - Virtual events.
  - Report-a-problem button.
- **Features:** feature registry and adoption, event catalog, zone metrics, PES.
- **Forms:** field-level form analytics and abandonment.
- **Process:** process mining via `case_id` (EBO_SALES first) and training needs.
- **Audit:**
  - Route sensitivity registry.
  - `nexus.audit()` (append-only).
  - Mass-export detection by request and row counts.
  - Privileged activity.
  - Failed auth.
  - Device inventory.
  - SSO sign-in log if the portal exposes one.
- **Optional:** page titles; business-outcome linkage once ERP/BI provide data.

**Phase 6: Replay, heatmaps and AI (about 20-30 dev-weeks plus infrastructure, needs explicit approval)**
- **Replay:**
  - Object storage and the chunked uploader.
  - Replay pilot on EBO_SALES only: triggered recording, strict masking, attribute scrubbing, viewer role and viewing audit.
  - Extended app by app afterwards, with finance, GST and agreement vault last or never.
- **Heatmaps:** wireframe background first.
- **AI:**
  - Deterministic RCA (this can move earlier because it has no LLM).
  - AI governance.
  - AI digest, Ask Nexus and session summaries.

**Phase 7: Optional.** Score-only CSAT, then everything on the parked list if the owner asks for it.

### First release shortlist (top 15, ranked)

1. SDK data-quality release: `routeTemplate`, XHR/early patch, `release`, `environment`, retry queue (M).
2. SDK safety: remote config and kill switch, performance budget, PII leak detector, privacy tests (M).
3. Identity-coverage push and KPI for every app (M).
4. Show stored dimensions, unverified activity, custom events and totals, plus indexes (S-M).
5. Subnet-to-store/office map (S, needs IT).
6. Heartbeat, threshold and error-spike alerts by email and Teams (M).
7. Employee and store directory from CSV, with `account_type` (M).
8. Role model, per-app scoping, PII masking and access audit (L).
9. Sessions table and exact rollups (L).
10. Funnels with server-verified outcomes (L).
11. Retention, stickiness and lifecycle (M).
12. Adoption by store, department and role, plus the store scorecard (M).
13. User 360 v2, purpose-gated (L).
14. Rage, dead and error clicks, U-turns and scroll depth (M).
15. Route-change timing, failed browser requests, JS errors (after the ADR) and the Issues inbox (L).

## Decisions needed

1. **Overall purpose and privacy stance.**
   - Options: (a) product quality and adoption only; (b) quality, adoption and security investigations, with individual views gated by role and stated purpose and every access logged; (c) full per-employee productivity monitoring.
   - **Recommendation: (b).**
   - Why: s.7(i) DPDP covers employment purposes, but per-employee productivity views carry the highest trust and misuse risk and tend to become performance ratings. Option (b) still gives every detail when there is a legitimate reason. Aggregate-first is a policy choice that legal will probably endorse, not a statutory test.

2. **Team capacity, timeline and first release.**
   - Options: (a) approve the top-15 shortlist as release 1; (b) a smaller cut (Phase 1 plus alerts only); (c) the full roadmap at once.
   - **Recommendation: (a), once the number of developers is known.**
   - Why: about 110 features cannot be judged without a cost. The phase estimates (about 110-150 dev-weeks before replay and AI) only make sense against real capacity.

3. **Module priority order.**
   - Options: analytics-first; reliability-first; security-first; replay-first.
   - **Recommendation: analytics-first, as in the roadmap, with the Phase 1 data-quality fixes and the heartbeat alert shipped immediately.**
   - Why: the complaint is weak user monitoring. Identity, org data, User 360 and funnels answer it with data we mostly already have, and governance has to come before replay and security tooling.

4. **Legal and DPIA gate, and DPDP Rules timing.**
   - Options: (a) legal and DPO sign-off before Phase 2b and again before any of autocapture text, error messages, replay or AI; (b) a single sign-off at the start; (c) no formal review.
   - **Recommendation: (a), and put the May 2027 commencement into the plan.**
   - Why: each of those features widens the personal-data surface. The Rules' retention, security and breach duties start around May 2027, about 6 months from today.

5. **Source and owner of employee, store, role, region and manager data.**
   - Options: (a) portal JWT claims; (b) HRMS export or API (which HRMS?); (c) IdP directory API, if one exists; (d) a CSV maintained by HR/IT; (e) apps send traits via `getUserTraits`.
   - **Recommendation: (d) CSV as the primary path now, (b) later. Use (e) only for the app-specific role. Use (a) only if the read-only JWT check shows the claims exist, and treat any new claims as a request to the portal team.**
   - Why: the SSO is a custom portal JWT that returns only email and expiry, so there may be no IdP directory. The owner must name the system, the team that owns its accuracy, and confirm that store codes match retail master data.

6. **Identity coverage as a gate.**
   - Options: (a) set targets (for example at least 90% of events verified per app) and hold org and per-person features for apps below the target; (b) launch them anyway and label the gaps.
   - **Recommendation: (a), with (b)'s labels on Integration health.**
   - Why: ebo-kpiverse, finance-recon and finance-tool send no verified user. Org views would be blind or misleading there.

7. **Shared and generic store logins.**
   - Options: (a) tag them as `shared_store` and use them in group analytics only; (b) count them as people; (c) ask IT to retire shared logins.
   - **Recommendation: (a) now, and raise (c) with IT.**
   - Why: one login used by several staff distorts User 360, proficiency and adoption numbers.

8. **Who can see what (role matrix).**
   - Options: (a) keep the viewer/admin switch; (b) app owners see only their own apps; leadership sees aggregates; support sees individuals with a stated purpose; security sees audit data; HR sees aggregates only; (c) everyone sees everything.
   - **Recommendation: (b), enforced with RLS and the access audit log. Scheduled reports render with the recipient's permissions.**
   - Why: exports, reports and AI bypass UI-only checks, and HR seeing individual activity is the biggest misuse risk.

9. **Minimum group size vs store drill-down.**
   - Options: (a) a single k of 5 or more everywhere, which suppresses almost every store today; (b) audience-based k: 1 for app owners and support with purpose logging, at least 5 for leadership and HR; (c) no minimum.
   - **Recommendation: (b). Show store adoption as "has at least 1 active user" plus counts, and show the suppression rate on every view.**
   - Why: stores have 1 to 3 users. k-anonymity and per-store detail cannot both hold, so the trade-off has to be made explicitly.

10. **Individual metrics in User 360 and individual scores.**
    - Options: (a) never per person, only store or app level; (b) per person for app owners and support to help users, behind a stated purpose and logged, never for HR or manager appraisal; (c) visible to managers.
    - **Recommendation: (b). Active time, days-active and lifecycle are hidden by default. Working hours stay aggregate-only. The leaver-window and risk features go to the Security investigator only, with a written justification.**
    - Why: put together, those fields form a productivity and insider-risk profile. Opaque scores get used as performance ratings. We publish every formula.

11. **Employee transparency.**
    - Options: (a) nothing beyond existing policies; (b) a written HR notice, the "What Nexus collects" page and a grievance contact; (c) (b) plus a consent banner in each app.
    - **Recommendation: (b), plus the optional "My data in Nexus" self-view, and per-session consent only for any future co-browse.**
    - Why: s.7(i) processing may not legally require notice or consent, so this is a trust choice. Legal guidance commonly recommends a written policy, and it should be live before User 360 v2 or replay.

12. **Retention per data class.**
    - Options: (a) keep 6 months for everything; (b) raw events 13 months; `person_app_day` 13 months; aggregates without a person key 5 years; audit and security 3 years; replays and frontend error messages 30 days; quarantine 14 days; (c) keep everything forever.
    - **Recommendation: (b), but first ask legal whether Nexus data counts as "traffic data or logs" under Rules 6 and 8(3). If it does, the floor is 1 year for raw events and any shorter class (replays, errors) needs a written justification. Data is erased after the purpose ends (s.8(7)).**
    - Why: year-over-year trends need longer aggregates, there may be statutory minimums, and employee-level history should not live forever.

13. **Session definition.**
    - Options: (a) per app, per tab, 30-minute idle (today's behaviour); (b) org-wide across all `*.nexus.libas.in` apps via a parent-domain cookie; (c) shift-based.
    - **Recommendation: (a) for sessions, with cross-app paths built at the person level by time proximity. Revisit (b) if cross-app journeys turn out to be core.**
    - Why: sessionStorage is per origin, and a parent-domain cookie is a new identifier across apps that needs its own ADR. The sessions table, paths, frustration and replay all depend on this choice.

14. **Element text in autocapture.**
    - Options: (a) never: tag, role, `data-nexus-*` and scrubbed `aria-label` only; (b) static button, link and tab text only, at most 64 characters, PII-regex masked, never inputs or table cells, behind a per-app switch; (c) any visible text, regex-masked.
    - **Recommendation: (a) at launch, and (b) per app after the EBO_SALES pilot under a new ADR. No text hashes.**
    - Why: ids and `data-*` attributes in business apps often carry record ids and GSTINs, so the attribute allow-list matters more than text. Hashing short labels gives no protection.

15. **Frontend and server error details.**
    - Options: (a) codes only, no frontend errors; (b) type, fingerprint and symbolicated frames, no message; (c) (b) plus a scrubbed message template kept 30 days.
    - **Recommendation: (c) for frontend errors. The server keeps codes plus the exception class name. The ADR amends CLAUDE.md rule 6 and the DB rule. Frame URLs lose their queries, and extension frames are dropped.**
    - Why: grouping and fixing frontend errors needs some message signal. Useful grouping also depends on teams adopting source maps.

16. **Session replay.**
    - Options: (a) no replay, keep the text replay; (b) error- and frustration-triggered only, strict masking, attribute scrubbing, pilot on EBO_SALES; (c) sampled plus triggered on all apps; (d) relaxed masking.
    - **Recommendation: (a) until Phase 6, then (b), with finance, GST and agreement vault excluded until a separate review.**
    - Why: rrweb records attributes (href and src with queries, title, alt, placeholder, `data-*`) even in strict mode. The v2 recorder is still alpha. Replay needs object storage, a chunked uploader and remote config. Finance screens show exactly the PAN, GSTIN and amounts we must never collect.

17. **Heatmap background.**
    - Options: (a) a wireframe of element boxes; (b) a masked DOM snapshot.
    - **Recommendation: (a). Allow (b) only under the replay ADR.**
    - Why: a DOM snapshot carries the same exposure as replay.

18. **How much work we ask of app teams, and how they get the SDK.**
    - Options: (a) SDK upgrades only; (b) upgrades plus optional tiers (`getUser`/`getUserTraits`, `propagateHeaders` and the early import, `release`/`environment`, `data-nexus-block`, `audit()`, `case_id`, the source-map CI step); (c) instrumentation mandated per app. For distribution: a private npm registry vs versioned vendoring.
    - **Recommendation: (b), with EBO_SALES as the reference implementation and an integration-level badge per app, delivered through a private registry.**
    - Why: hard rule 1 means we cannot edit their code, and even linking and release need a few lines from them. Vendoring makes every "automatic" feature slow to arrive.

19. **Remote control of capture.**
    - Options: (a) Nexus may switch capture modules on or off per app through signed remote config, including an emergency kill switch, while each app team still chooses its maximum level; (b) only code-level config by app teams.
    - **Recommendation: (a), with app owners able to see every change.**
    - Why: without it we cannot quickly disable a capture that breaks a host app. Replay sampling, exclusions and the autocapture allow-lists also depend on it.

20. **Client platforms in scope.**
    - Options: (a) React web apps only; (b) plus a plain-JS script tag; (c) plus Android WebView and handheld scanner apps.
    - **Recommendation: (a) now. Add (b) or (c) only if stock audit or other flows actually run on non-React clients.**
    - Why: the owner needs to tell us which devices stores and warehouses use.

21. **Test and internal traffic.**
    - Options: (a) exclude dev and staging, the Nexus team, QA accounts and service accounts by default; (b) include everything.
    - **Recommendation: (a). The owner and IT supply the people and accounts to exclude.**
    - Why: test traffic pollutes DAU, funnels and alerts. Local dev currently sends `admin@libas.in` events.

22. **Network and location.**
    - Options: (a) IT provides the CIDR list per store, warehouse, HO and VPN, and the proxy forwards X-Forwarded-For; (b) offices only; (c) drop location features.
    - **Recommendation: (a).**
    - Why: 100% private IPs make Geography useless. "Which store or warehouse" is the useful location for retail.

23. **Scope of audit and security features.**
    - Options: (a) route sensitivity registry, `audit()` (append-only, no hash chain), mass-export detection by counts, privileged activity, failed auth and leaver activity; (b) (a) plus a UEBA risk score and SIEM streaming; (c) none.
    - **Recommendation: (a). Defer (b) until the security team asks and names a SIEM. Drop impossible travel.**
    - Why: few users and all-private IPs make UEBA noisy, and it moves Nexus into insider-risk tooling, which needs separate legal sign-off.

24. **Storage and infrastructure.**
    - Options: (a) Postgres only with exact rollups; (b) add TimescaleDB now; (c) a ClickHouse sidecar now. Also: may MinIO/S3 be provisioned on the host, and may the external DB host allow a non-owner role, RLS and extensions?
    - **Recommendation: (a). Ask for object storage only when replay or source maps are approved.**
    - Why: volume is tiny. The owner and IT must confirm what the external DB host (ADR 0002) and the single host (ADR 0004) allow.

25. **Alert and report channels and language.**
    - Options: email; Teams (Workflows webhook) or Google Chat; Slack; WhatsApp Business (per-message cost and approved templates); webhook and in-app bell. Language: English only, or Hindi and English.
    - **Recommendation: email, the chat tool Libas actually uses, and a webhook first. WhatsApp later, for critical alerts to app owners only. Hindi for store and area manager digests if they are recipients.**
    - Why: the owner must name the collaboration suite. No PII goes into message bodies.

26. **Ticketing integration.**
    - Options: Jira, Freshservice, GLPI, other, or none.
    - **Recommendation: integrate with whichever tool IT support uses today, once the Issues inbox exists.**
    - Why: it closes the loop from "report a problem" or an alert to an assigned fix.

27. **Dashboards.**
    - Options: (a) curated persona dashboards (owner, app owner, leadership, store or area manager, support, security) plus saved views; (b) a free-form drag-and-drop builder now.
    - **Recommendation: (a) now, with (b) as a later decision.**
    - Why: there are only a handful of dashboard users. A builder plus a general DSL is XL effort for little extra value at this stage.

28. **Business outcomes and ROI.**
    - Options: (a) import store-level KPIs (sales, shrinkage, audit accuracy, GST filed on time) from ERP/BI and use INR cost bands per role; (b) usage only.
    - **Recommendation: (a), store-level only, once a data owner is named.**
    - Why: leadership will ask whether adoption improves the business and what friction costs in INR. Usage data alone cannot answer that.

29. **AI and LLM use.**
    - Options: (a) no AI; (b) deterministic root-cause analysis only, no LLM; (c) a company-approved cloud LLM with zero data retention, pseudonymous aggregates only and a redaction layer; (d) a self-hosted model.
    - **Recommendation: (b) as soon as rollups exist, and (c) in Phase 6 behind an org switch and usage log.**
    - Why: employee activity leaving the company needs an approved processor contract. Self-hosting costs GPU operations for little gain at this scale.

30. **Product boundary.**
    - Options: (a) observe and alert only, plus the "Report a problem" button; (b) add score-only CSAT surveys; (c) a full digital adoption platform (guides, checklists, flags).
    - **Recommendation: (a). Revisit (b) after Phase 4. Defer (c).**
    - Why: guides and flags render UI inside other teams' apps (hard rule 1) and are products in their own right. Free-text surveys conflict with the "no typed text" rule.

31. **Contract versioning.**
    - Options: (a) additive within v1 (new event types, optional fields, DB CHECKs); (b) cut /v2 now.
    - **Recommendation: (a). The only planned non-additive change is the `person_id` re-key's handling of email columns, which needs its own ADR and an exception to ADR 0005.**
    - Why: additive changes keep existing integrations working and let apps upgrade at their own pace.

32. **Confirm the "Not building or parked" list.**
    - Options: accept it as is, or pull items back in.
    - **Recommendation: accept it.**
    - Why: a tighter core gets to a "best software" first release faster and keeps privacy risk proportionate.

## Sources

- https://posthog.com/docs/product-analytics/autocapture
- https://posthog.com/docs/product-analytics/group-analytics
- https://posthog.com/docs/data/persons
- https://posthog.com/docs/product-analytics/lifecycle
- https://posthog.com/docs/session-replay/privacy
- https://posthog.com/handbook/engineering/session-replay/session-replay-architecture
- https://amplitude.com/docs/data/autocapture
- https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-build
- https://docs.mixpanel.com/docs/data-structure/group-analytics/group-analytics-faq
- https://docs.mixpanel.com/docs/data-governance/lexicon
- https://heap.io/blog/virtual-events
- https://docs.datadoghq.com/real_user_monitoring/browser/frustration_signals/
- https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/data_collected/
- https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/apm/
- https://docs.datadoghq.com/monitors/guide/on_missing_data/
- https://github.com/GoogleChrome/web-vitals
- https://developer.chrome.com/blog/final-soft-navigations-origin-trial
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming
- https://developer.mozilla.org/docs/Web/API/NetworkInformation
- https://docs.sentry.io/platforms/javascript/session-replay/configuration/
- https://docs.sentry.io/product/session-replay/web/performance-overhead/
- https://docs.sentry.io/concepts/data-management/event-grouping/
- https://docs.sentry.io/product/releases/health/
- https://github.com/rrweb-io/rrweb/blob/main/guide.md
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking
- https://learn.microsoft.com/en-us/clarity/insights/semantic-metrics
- https://contentsquare.com/platform/capabilities/frustration-score/
- https://zuko.io/form-analytics
- https://learn.microsoft.com/en-MY/microsoft-365/admin/adoption/privacy?view=o365-worldwide
- https://learn.microsoft.com/power-automate/process-mining-processes-and-data
- https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/
- https://grafana.com/blog/2025/02/28/how-to-implement-multi-window-multi-burn-rate-alerts-with-grafana-cloud/
- https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/
- https://www.metabase.com/learn/metabase-basics/administration/permissions/row-and-column-security-use-cases
- https://docs.snowplow.io/docs/fundamentals/failed-events/
- https://workos.com/blog/the-developers-guide-to-audit-logs-siem
- https://ksandk.com/data-protection-and-data-privacy/can-employers-monitor-employees-dpdp-act/
- https://ksandk.com/data-protection-and-data-privacy/data-retention-and-deletion-under-indias-dpdp-rules/
- https://compass.khaitanco.com/how-indias-new-data-protection-law-works-at-the-workplace
- https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified