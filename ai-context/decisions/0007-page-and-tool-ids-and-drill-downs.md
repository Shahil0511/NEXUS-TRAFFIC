# ADR 0007 — Opaque page / tool ids and the users × apps × features drill-downs

- **Status:** accepted (2026-10-14); implemented 2026-10-14 (Wave 2 of the UX roadmap, see
  [PROGRESS.md](../PROGRESS.md)).
- **Context:** after Wave 1 ([ADR 0006](0006-navigation-search-and-applications.md)) a viewer could reach
  apps, users and routes, but pages and tools had no page of their own, a route could not say who calls
  it, a user could not show which routes and apps they use, and Errors could not say who was hurt.
  05-conventions §5 forbids ingested strings (path templates, tool names) in URLs, and neither column has
  a stored id.
- **Decision:**
  1. **Ids computed, not stored.** `toPageId(app, pathTemplate)` / `toToolId(app, tool)` in
     `packages/shared/src/endpoint-id.ts` (node-only): UUID v5 with their own fixed namespaces. The API
     adds `pageId` / `toolId` to every page/tool it returns; the dashboard links with
     `PAGES.pageDetail(app, pageId)` / `PAGES.toolDetail(app, toolId)` (app slug + uuid only).
  2. **Resolution in the service.** `ROUTES.pages.detail` = `GET /v1/pages/:app/:pageId` and
     `ROUTES.tools.detail` = `GET /v1/tools/:app/:toolId`: the service lists the app's distinct templates /
     tools in the window (`listPageTemplates`, `listToolNames`) and picks the one whose id matches; no
     match → 404. No migration, no backfill.
  3. **Who uses what, both ways** — new DTO fields, no new tables: `EndpointDetailDto.uniqueUsers/topUsers`,
     `ErrorSummaryDto.usersAffected/topAffectedUsers` (+ `userKey` scope on both errors leaves),
     `UserProfileDto.topEndpoints/perApp`, `UserSummaryDto.failedRequests/firstSeenAt`, the Users list
     sortable by `USER_SORT_VALUES` (whitelisted ORDER BY), `PageStatsDto.distinctUsers`, `ROUTES.users.activity`
     (DAU per IST day + WAU/MAU), `AppTrafficDto.identifiedPct/linkedPct` (integration quality).
  4. One shared shape for "a user and a count": `UserUsageDto` (route callers, page viewers, tool users,
     users hit by failures), rendered by `components/TopUsersList.tsx`.
- **Consequences:**
  - Renaming a template or tool changes its id (old links 404) — the same trade-off as `endpoint_id`.
  - Detail lookups scan the app's distinct templates/tools in the window; measured fine at today's volume
    (deployed DB, 2026-10-14: page → API calls ≈ 250 ms, DAU 30 d ≈ 100 ms, sorted Users 30 d ≈ 85 ms).
    If it grows, add a stored `page_id` column + index through a migration and a new ADR.
  - `api_requests.page_view_id` has no index; page → API calls filter by app + window first.
