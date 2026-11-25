# ADR 0019 — Names on object pages for admins only

- **Status:** accepted (2026-11-25). Changes in part point 1 of
  [ADR 0015](0015-admin-only-person-pages-and-access-log.md) (which reads stay open to every viewer) and the
  "top users" of the drill-downs in [ADR 0007](0007-page-and-tool-ids-and-drill-downs.md). The order of those
  lists stays as [ADR 0018](0018-people-list-count-sorts-restored.md) left it.
- **Context:** ADR 0015 made the person page and the lists narrowed to one person admin-only, but left every
  object read open to every viewer. Three of those reads carry people: `pages.detail` and `tools.detail` send
  `topUsers` (verified emails with a count each), and `endpoints.detail` sends `topUsers` and `slowest` (single
  requests, each with the caller). The App page's "Who uses it" panel reads `users.list` for every viewer. The
  owner's rule is that person-level data (who someone is, single requests with a person) is shown to dashboard
  admins only, while counts stay for everyone.
- **Decision:**
  1. **Three object reads send people to admins only.** `PageDetailDto.topUsers`, `ToolDetailDto.topUsers`,
     `EndpointDetailDto.topUsers` and `EndpointDetailDto.slowest` (`packages/shared/src/dto/`) are `… | null`:
     the services (`PageService.detail`, `ToolService.detail`, `EndpointService.detail`) build them through
     `forAdmins(viewer, () => …)` in `apps/api/src/domain/viewer.ts`, which evaluates the list for an admin and
     returns `null` for everyone else (never an empty list, so "hidden" and "none" stay distinct). The counts
     (`page.distinctUsers`, `tool.distinctUsers`, `uniqueUsers`) and every other field are the same for every
     viewer. The controllers pass `requireViewer(res)`; the responses keep `private, max-age=15`. The
     repositories still compute the lists (no SQL change); `mapRequestSample` keeps masking the IP by role.
  2. **The App page's people panel is for admins only.** `ApplicationDetailView` sends the `users.list` read
     only once `useMe` says admin (`enabled`), shows a skeleton while the viewer is unknown, and shows everyone
     else the app's verified-people count (from the traffic row) and a lock note instead of the list. A failed
     `useMe` read shows an error with a retry, never the viewer state. This is a client rule: `users.list`
     itself stays open (point 4), so the panel's "All users of this app" link stays for every viewer, like the
     Users metric's link.
  3. **Nothing new is logged.** No read is added, so nothing new is written to `traffic.person_access_log`.
     Admins' views of these multi-person lists are not recorded: the log holds one person per row.
  4. **Unchanged for now:** the People list (`users.list`, `users.search`), Problems (`errors.summary`
     `topAffectedUsers`, `errors.list`), Live and the failed-request list keep ADR 0015's rule until a
     follow-up ADR.
  5. **Order and wording.** The lists stay "most first" (ADR 0018) and are described as a sort ("Most views
     first"); viewers read "Only admins see who they are." / "Only admins see single requests." in neutral
     words (`NEUTRAL_COPY_BANNED`, `apps/web/src/lib/neutralCopy.ts`).
  6. **On screen** one component draws the panel for all three objects: `apps/web/src/components/WhoUsesIt.tsx`
     (count sentence for everyone; the list for admins; the lock note when `users` is null), with the note text
     in `apps/web/src/components/AdminsOnlyNote.tsx`.
- **Consequences:**
  - A new object read that carries people (emails, user keys with a name, single requests) MUST build that
    field with `forAdmins` and get a viewer / admin service test (array for an admin, `null` for a viewer,
    counts identical).
  - The web treats `null` as "hidden for you", `[]` as "none in this range".
  - Lifting point 4 (the People list and Problems) needs a new ADR.
