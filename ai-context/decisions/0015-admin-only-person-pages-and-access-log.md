# ADR 0015 — Admin-only person pages and the person access log

- **Status:** accepted (2026-11-23). Supersedes the "Dashboard access" row of
  [ADR 0001](0001-contract-and-naming.md) for the role split (the allowlist / domain / admin env
  policy itself is unchanged). The person page itself is described in
  [ADR 0014](0014-object-first-navigation-and-person-page.md). The deeper per-day facts of the person
  page keep these rules: [ADR 0017](0017-person-daily-depth.md).
- **Context:** ADR 0001 gave viewers every analytics read and admins only app/key management and
  IP addresses. The person page (one verified user's summary, daily activity, devices and
  timeline) puts everything about ONE person on one screen, and the Visits and Problems lists can
  be narrowed to one person with `?userKey=`. Those reads need a tighter rule than aggregate
  analytics, and a record of who made them.
- **Decision:**
  1. **Which leaves are admin-only.** Two lists, both named once in `packages/shared/src/routes.ts`:
     - `PERSON_ROUTE_LEAVES` (`users.profile`, `users.timeline`, `users.devices`, `users.daily`):
       always admin-only (`...admin` = `ssoAuth` + `dashboardCsrf` + `requireAdmin` in
       `apps/api/src/http/routes/index.ts`). The admin check runs before the person key is
       validated, so a non-admin gets 403 `FORBIDDEN` before anything about the person is read.
     - `PERSON_FILTERED_ROUTE_LEAVES` (`journeys.sessions`, `errors.summary`, `errors.list`,
       `live.online`): open to every viewer, but admin-only once `?userKey=` narrows them to one
       person (`requireAdminForUserKey` in `apps/api/src/http/middleware/dashboard-guards.middleware.ts`,
       after `validateQuery`).
     - `privacy.accessLog` (the log itself): admin-only.
     Lists of people (`users.list`, `users.search`, `users.activity`), the single-session replay
     (`journeys.session`) and the aggregate pages stay open to every viewer.
  2. **The access log table.** `traffic.person_access_log`
     (`apps/api/migrations/0013_person_access_log.sql`): `id`, `viewed_at`, `viewer_email`,
     `subject_user_key` (32 bytes, same as the event tables), `subject_email_masked`, `surface`.
     `surface` is one of `PERSON_ACCESS_SURFACE_VALUES` (`packages/shared/src/constants/traffic.ts`:
     one per person leaf, plus `person_visits` and `person_failures` for the narrowed lists); a CHECK
     mirrors the enum. `live.online?userKey=` is the person page's own "Online now" badge and is
     covered by that page's `person_profile` row. Append-only: triggers refuse UPDATE, DELETE and
     TRUNCATE for every role (the owner included), and `grants.ts` gives `nexus_app` SELECT + INSERT
     only (and REVOKEs the rest). Read newest first, keyset `(viewed_at, id)`, optionally for one
     person, `Cache-Control: no-store` (`PrivacyController.accessLog` → `PrivacyService.accessLog` →
     `PersonAccessLogRepository.list`), shown on the Privacy & access page (`PAGES.privacy()`).
  3. **Recording.** `PersonAccessRecorder` (`apps/api/src/services/person-access.recorder.ts`) is called
     after a successful person-level answer (`UserService`, `JourneyService.sessions`,
     `ErrorService.summary` / `.list`). No row for a refused or failed read (403, 404 profile, unknown app,
     range too large). A failed INSERT never fails the read: it logs a warning with the surface and the
     pg error code only.
  4. **Coalescing: rows mean looks, not requests.** The same viewer + person + surface is recorded at
     most once per `PERSON_ACCESS_COALESCE_MS` (10 min), decided in memory per api process
     (`apps/api/src/services/person-access.coalescer.ts`), so repeats cost no database call. The error is
     on the safe side: a restart or a second replica adds a duplicate row, never loses one. A concurrent
     request with the same key waits for the running attempt and records itself if that attempt wrote
     nothing. The dashboard never refetches person-level queries because of live traffic
     (`isTrafficDrivenKey`, `apps/web/src/features/live/autoRefreshPolicy.ts`), and each person-page tab
     sends its read only while it is open, so a row is written only for a part that was actually shown.
     One exception, by design: the profile read (`person_profile`) feeds the page header and the
     identity card as well as the Summary tab, so it is sent on every open of the person page, on
     any tab. The log therefore labels that surface "Identity card and Summary"
     (`SURFACE_LABELS`, `apps/web/src/features/privacy/accessLogColumns.tsx`), not "Summary".
  5. **Masking.** The person is named by `user_key` plus a MASKED email (`maskEmail`: first character,
     `***`, then `@domain`), taken from their newest event in the read's window
     (`WebEventQueryRepository.findUserEmail`, window- and environment-bound). A CHECK refuses any other
     form, so the full address is never stored in this table. No event in the window means nothing about
     the person was shown, so no row is written. The admin is stored by their sign-in email, which is
     only shown to admins.
  6. **The UI only offers what the viewer may open.** Links and buttons to a person page (People list,
     command palette people results, the visit page's "Person page" button, `UserLink`) are shown to admins only
     (`apps/web/src/features/me/useCanOpenPersonPages.ts`); a viewer who still opens one sees the
     "Only admins" state (`components/AdminOnly.tsx`) and no person read is sent.
- **Consequences:**
  - Non-admin viewers lose the person page and the `?userKey=` filters (403 `FORBIDDEN`); they keep
    every aggregate page and the People list. A viewer who opens `/journeys?userKey=` or
    `/errors?userKey=` directly sees the API's 403 as a generic error state.
  - A new person-level read MUST be added to one of the two lists, get a surface (shared enum + the 0013
    CHECK, checked by `apps/api/test/db/schema-parity.integration.test.ts`) and be covered by
    `apps/api/test/person-access.routes.test.ts`.
  - Nothing prunes the access log; it stays small because it is coalesced and admins only.
