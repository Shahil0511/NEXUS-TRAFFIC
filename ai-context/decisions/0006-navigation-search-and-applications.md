# ADR 0006 — Linked navigation, Ctrl+K search (emails never in URLs) and the Applications page

- **Status:** accepted (2026-10-14); implemented 2026-10-14 (Wave 1 of the UX roadmap, see
  [PROGRESS.md](../PROGRESS.md)).
- **Context:** a UX audit of the dashboard found that navigation stopped after one click (user emails,
  route templates and app names were plain text although the payloads already carried the opaque ids),
  there was no search beyond two page-local boxes, no screen answered "which users use which app", and
  four numbers contradicted each other (90d preset → `RANGE_TOO_LARGE`; Overview "Identified users"
  counted API calls only; Users "Sessions" counted API sessions that Journeys cannot list; Errors opened
  from a route scoped only its table). The Users search also put the typed email into `?q=` and
  `GET /v1/users?search=` — against ADR 0001 ("URLs never carry emails": gateway and edge access logs
  record URLs).
- **Decision:**
  1. **Email search is a POST.** New leaf `ROUTES.users.search` = `POST /v1/users/search`, body
     `userSearchBodySchema` (window + `search` + cursor/limit). `userListQuerySchema` no longer accepts
     `search`. The web keeps the typed text in React state only (`features/users/useUserSearch.ts`);
     it is never written to the URL, the browser history, localStorage or a tab title.
  2. **Every entity links, through opaque ids only.** Users → `PAGES.userDetail(userKey)` (verified
     identities only — claims stay text), routes → `PAGES.endpointDetail(endpointId)`, sessions →
     `PAGES.sessionDetail(app, sessionId)`, apps → `PAGES.applicationDetail(slug)` (`components/AppChip.tsx`;
     the registered slug, validated with `appSlugSchema`). To make that possible the DTOs gained ids
     the API already stored: `RequestSampleDto.sessionId`, `TimelineItemDto.endpointId`,
     `SessionEventDto.endpointId`, `LiveEventDto.userKey/endpointId/sessionId`. Ingested strings (paths,
     templates, tool names) still never become URL segments (05-conventions §5).
  3. **Command palette** (`components/CommandPalette.tsx`, Ctrl/⌘+K or "/"): pages (`NAV_ITEMS`), apps,
     users (via `users.search`), routes (via `endpoints.list?search=` — a route template is not PII) and
     range actions.
  4. **Applications page** (`PAGES.applications()` / `PAGES.applicationDetail(app)`, new leaf
     `ROUTES.overview.apps` → `WindowedListDto<AppTrafficDto>`): one row per registered app with users,
     API calls, error rate, p95, page views, sessions, tool uses and deltas; the app page previews its
     users, routes, pages, tools and failing routes, each "View all" opening the list filtered to it.
     Path `/applications` (not `/apps`, which is the admin page — prefix matching would collide).
  5. **One definition per number:** identified users = distinct verified `user_key` over BOTH tables
     (`WebEventQueryRepository.countIdentifiedUsers`, same as the Users page); a user's / an app's
     `sessions` = distinct BROWSER sessions (what Journeys can replay); `errors.summary` accepts
     `endpointId`.
  6. **Pages declare the filters they read** (`NavItem.filters` in `apps/web/src/lib/nav.ts`): the top
     bar hides the app/range controls where they do nothing and disables presets longer than the page's
     API cap; a `RANGE_TOO_LARGE` response renders a "Show the last 30 days" fix instead of an error.
- **Consequences:**
  - A searched Users list is not shareable by URL (deliberate: the URL would contain an email).
  - `overview.apps` runs one GROUP BY per table per window (current + previous) plus `AppRepository.list`;
    measured on the deployed database (2026-10-14, ~28 k rows / 30 days) at ~35 ms.
  - Breadcrumb `from=` links, sortable Users, per-page/per-tool detail pages, "who calls this route"
    and DAU/WAU/MAU are Wave 2 of the roadmap (not part of this ADR).
