# ADR 0017 — Per-person daily facts: neutral labels, a one-day drill-down and stated limits

- **Status:** accepted (2026-11-24), first version. Builds on [ADR 0014](0014-object-first-navigation-and-person-page.md)
  (the person page and its Daily activity tab) and keeps every safeguard of
  [ADR 0015](0015-admin-only-person-pages-and-access-log.md) (admin-only person reads, the person access log).
  Later steps of the same work extend this ADR in place; each extension says which step added it.
- **Context:** the Daily activity tab already showed, per IST day of one verified person, the first and last
  recorded event, the summed tab-visible time and some counts. The owner decided (option 2c) that the person
  page may go deeper into these per-person, per-day facts, under the existing ADR 0015 rules and without a
  reason prompt or a notice to the person (options 1a / 3b). That is the owner's call, recorded here. Facts
  about one person's days are easy to read as a judgement of the person, so the wording, the data contract
  and the screen itself must keep them plain facts.
- **Decision:**
  1. **Scope.** Per-person, per-day facts only: the list of active days (shipped), and in later steps a
     per-app split, a one-day view and a weekday × hour view of usual activity hours. All of it is
     admin-only and recorded in the access log exactly as ADR 0015 describes. No SDK change: only data the
     trackers already send is read, and there is no input or idle signal (no keystrokes, no pointer
     activity, no screenshots, no typed text).
  2. **Neutral labels.** On screen the per-person numbers use these names only: Time in app, Tab visible
     time, First activity, Last activity, Active days, Usual activity hours, Visit steps, Visits, Apps, Page
     views, Feature uses, API calls. Words that grade or compare people, put them in an order, or describe
     watching them are banned from rendered text, aria-labels, titles, alt text and placeholders. The banned list
     lives in ONE place, `NEUTRAL_COPY_BANNED` in `apps/web/src/lib/neutralCopy.ts`, and is enforced by:
     - `apps/web/src/features/users/personCopy.test.tsx`: renders every person-level screen (all person
       page tabs, the identity card, the admins-only state, the visit page, Privacy & access) from
       fixtures and scans the rendered text and those attributes;
     - `apps/web/src/lib/metricCopy.test.ts`: no metric label or definition uses a banned word;
     - `packages/shared/src/dto-safeguards.test.ts`: reads the DTO source files and fails on a field name
       that frames a person as graded, placed in an order of people or watched (the banned screen words
       in camelCase / snake_case form).
     Lists of a person's days are ordered by time (newest day first; within a day, by first activity), never
     by an amount.
  3. **Shipped in this first step (no API or database change):**
     - The tab's totals read Active days, Average first / last activity and Tab visible time ("added up over
       the active days"). Time in app is a one-day number and is never shown or totalled over many days.
     - Each day row shows its apps as `AppChip`s, its page views, feature uses and API calls (with failed),
       and its visit count as a link to the Visits page narrowed to the person AND that one IST day:
       `?userKey=` + `range=custom` from the day's IST midnight to the next one, keeping app and environment
       (`dayVisitsQuery`, `apps/web/src/features/users/dailyActivity.ts`). That list read is already
       admin-only and recorded as `person_visits` (ADR 0015), so the link adds no new kind of read.
     - The list visibly ends ("End of list · N days"), and every per-day view closes with a static panel,
       "About these numbers" (`apps/web/src/features/users/AboutTheseNumbers.tsx`): IST days, tab visible
       time is screen time of a front tab and not input, two visible tabs both count, one stretch without a
       tick counts at most 1 minute (added in step 3), server-only apps add no time, only verified
       activity is shown and a shared login mixes people, first / last activity are recorded events and
       not sign-in or sign-out times, raw data is kept about 6 months.
     - The identity card says First activity / Last activity (in the selected range); the visit page heads
       its steps "Visit steps", and the person timeline links to them by that name.
  4. **Definitions (fixed now, built in later steps).**
     - *Tab visible time* = Σ of the credited `page_time.visible_ms` deltas: two tabs visible at the same time
       both count, so it can exceed the clock time.
     - *Time in app* = the length of the union of page-visible intervals: overlapping tabs count once.
     - *Activity block* = a stretch of browser events whose gaps are all under a fixed join gap; a block's
       length is end − start and lengths are never summed on screen.
  5. **Per-app split and per-day chart (shipped in step 2).**
     - `users.daily` groups by (IST day, app) in SQL and folds the rows into days in TypeScript
       (`foldUserDays`); each day carries `perApp` (`UserDayAppActivityDto`) and its totals are the Σ of the
       apps. A row cap (`USER_DAILY_APP_ROWS_LIMIT`) drops a whole oldest day rather than show it with apps
       missing. Same single scan, same access-log surface (`person_daily`).
     - Apps are listed in the order they were first used that day, never by time or counts; an app seen only
       through API calls shows "no browser time" instead of 0; at most three lines, then "+N more" (local).
     - "Tab visible time per day" is one bar per IST day of the range in one colour, idle days drawn as 0,
       with no average, target or reference line.
  6. **Credit cap on one `page_time` delta (shipped in step 3).**
     - A browser tracker sends a `page_time` delta on every flush tick while the page is visible
       (`SDK_DEFAULTS.browser.flushIntervalMs`, 5 s). A delta far longer than a tick means the tick did not
       run (a sleeping laptop, a frozen tab) while the visible counter kept going, so it is not time the page
       was seen. Reads credit one row at most `VISIBLE_DELTA_CREDIT_CAP_MS` = 12 ticks = 60 s
       (`packages/shared/src/constants/traffic.ts`). The stored value is unchanged; only reads apply the cap.
     - ONE helper, `creditedVisibleMs(alias)` in `apps/api/src/db/sql.ts`, renders
       `CASE WHEN visible_ms > cap THEN cap ELSE visible_ms END`. It is a CASE and not LEAST because
       PostgreSQL's LEAST ignores NULL and would credit the cap to every API row of the person UNION and to
       every other event type.
     - It is applied at all four places a shown visible time is summed, so person, visit and page numbers
       agree on the same visit: the page view's time (`pageViewVisibleMs`: person timeline and visit steps),
       the visit stats (`sessionStatsStatement`: Visits list and visit header), the page stats
       (`pageStatsStatement`: avg / p50 on Pages and one page) and the person day (`listUserDailyActivity`).
       A unit test pins the CASE at each site and, in every read, fails on any aggregate (sum, avg, min,
       max, percentile) or LEAST / GREATEST over a raw `visible_ms`; only avg / p50 over the page stats CTE
       of already credited sums is allowed.
     - This changes shipped numbers: tab visible time on the person, visit and page screens drops where
       sleep gaps used to be credited. Trackers that tick normally are unaffected. The public browser guide
       states the tick and the cap (`docs/integration/03-browser-contract.md`, noted in `docs/CHANGELOG.md`);
       the Visible time tooltip (`METRIC_COPY.visibleTime`: Pages, one page, the Visits list and the visit
       header), the person tab visible time (`METRIC_COPY.activeTime`) and "About these numbers" say "one
       stretch without a tick counts at most 1 minute".
  7. **Visit steps of a verified person are admin-only; three more access-log surfaces (shipped in step 4).**
     - This changes ADR 0015, which kept the single-visit read (`journeys.session`) open to every viewer.
       A visit that has a verified person (`user_key`) is part of that person's data:
       `JourneyService.session` throws `ForbiddenError` (403 `FORBIDDEN`) to a non-admin and, for an admin,
       records `person_visit_steps` through `PersonAccessRecorder` (same coalescing). Anonymous and
       claimed-only visits stay open to every viewer and write no row.
     - "Verified" does not depend on the window the viewer picked. The summary's `user_key` covers that
       window only, so when it is empty the service probes the same session again over the window widened
       by `MAX_COUNT_RANGE_MS` on each side (`WebEventQueryRepository.findSessionUserKey`, one indexed
       probe per partition, same app and environment; one tab's events all carry one environment). A narrow
       custom range over the steps before sign-in therefore still gets 403, and an admin's row is named
       from that wider window.
     - The single-visit query is never refetched because of live traffic (`isTrafficDrivenKey`,
       `apps/web/src/features/live/autoRefreshPolicy.ts`): its key cannot tell a verified visit from an
       anonymous one, so the whole leaf refreshes on a real action only (open, focus, retry). A page left
       open adds no access-log row and a refused read is not re-sent.
     - The check lives in the service, not in the route table, because it depends on the data: the route
       stays `...dashboard` (`apps/api/test/person-access.routes.test.ts` pins that it reaches the
       controller for a viewer; `journey.service.test.ts` pins the 403 and the row).
     - `PERSON_ACCESS_SURFACE_VALUES` gains `person_day` and `person_pattern` (their reads ship in later
       steps) and `person_visit_steps`. Migration
       `apps/api/migrations/0014_person_access_surfaces_day_pattern_visit_steps.sql` swaps
       `person_access_log_surface_check` under the same name (widening only, `NOT VALID` then `VALIDATE`);
       0013 is applied and is not edited. The enum and the migration ship in the same deploy (migrate
       before the API).
     - Web: the visit page shows `PersonAdminOnly` with the visit's own trail on a 403
       (`apps/web/src/features/journeys/SessionDetailView.tsx`; the state and `isForbidden` live in
       `apps/web/src/components/PersonAdminOnly.tsx`, shared with the person page), never a generic error; the
       Privacy & access log names the parts "One day", "Usual activity hours" (both lead to the Daily
       activity tab) and "Visit steps" (the row has no visit id, so it leads to the person's Visits list).
  8. **One-day view (shipped in step 5).**
     - `ROUTES.users.day` (`?day=YYYY-MM-DD`, an IST calendar day, `userDayQuerySchema` built from the plain
       `timeWindowShape` because the refined window schema cannot be picked) is a person leaf: admin-only in the
       route table, `PERSON_ROUTE_LEAVES`, recorded as `person_day`. App and environment apply; the global range
       does not (a stray `range` is stripped). A day in the future or more than `USER_DAY_LOOKBACK_DAYS` (183,
       about the raw retention) back is a 400.
     - `UserService.day` runs at most three statements at once: the day's (day, app) rows, the blocks and the
       pages; then, only when the day has activity, the features and the visits (`listSessions` narrowed to the
       key, newest first, as on the Visits page). A day without activity is a 200 with `summary: null`.
     - **Empty answers are logged too.** `PersonAccess.emailLookup` lets a caller name a wider window for the
       email lookup than the read's own; the one-day view passes the day itself plus the last
       `MAX_COUNT_RANGE_MS` before now, so an empty day is recorded whenever the person had any event in that
       time, and a day older than 93 days is still found inside the day.
     - Blocks, time in app and the clamp to the day start follow the definitions of point 4 (mechanism in
       `07-data-model.md`); the day totals are window functions evaluated before the block LIMIT, so time in
       app and the calls outside blocks cover the whole day even when only the first blocks are listed. Every
       table of every statement is bounded by the day, app and environment, the LATERAL call count included.
     - Web: the Date of each daily row links to `?tab=daily&day=…`; `UserDailyActivityTab` switches on that
       param (`useUserDetailDay`; an invalid day means all days; changing tab drops it). `useUserDay` is sent only
       once the viewer is known to be an admin, and its key is not refetched by live traffic
       (`PERSON_USER_LEAVES`). The view shows five KPIs (time in app with tab visible time as its hint), the
       00:00-24:00 timeline (decorative, its text in the Activity blocks table), apps, pages and features in
       first-use order (no bars, no "top"), visits whose Visit steps link reads that same day (custom range), an
       "End of day" marker (with the day's whole block count, `blockCount`) and "About these numbers". The date
       input opens a typed day only on Enter, blur or "Show day"; a day outside [today − 183, today] in the URL
       sends no read and says which days open, and Previous / Next step back into that range. Its tables are fixed-layout and fit 1280 px.
  9. **Usual activity hours (built in step 6, screen switched off).**
     - `ROUTES.users.pattern` (`?range=7d|30d`, default `30d`, `userPatternQuerySchema` from the plain
       `timeWindowShape`; the global range does not apply) is a person leaf: admin-only, `PERSON_ROUTE_LEAVES`,
       recorded as `person_pattern`, also for an empty answer (`emailLookup` = the window plus the last
       `MAX_COUNT_RANGE_MS`, as for one day).
     - The range is widened to whole IST days (`wholeReportingDays`): 8 days for 7d, 31 for 30d, never more.
       ONE statement over the same bounded, keyed UNION ALL of both tables as the daily read, grouped by the
       IST weekday and hour of each event (`reportingLocal`: the wall-clock time in Asia/Kolkata, not UTC),
       with `GROUPING SETS ((weekday, hour), ())` for the window's distinct active days in the same scan. A
       cell carries the distinct IST days with any activity in that weekday-hour and its credited tab visible
       time; empty cells are left out (at most 168 + 1 rows, no LIMIT). `weekdayDayCounts` gives the calendar
       days of each weekday in the window, the denominator of a cell's share.
     - Web: `UsualActivityHoursPanel` (own `Last 7 days | Last 30 days` control; app and env from the global
       filter) under the daily list, with `HourGrid`: a 7 × 24 CSS grid in one colour whose opacity follows
       the share (any activity is drawn at least `MIN_ACTIVE_CELL_OPACITY` (0.15), then in proportion to the
       share, so a rare hour stays visible; the legend uses the same mapping), a sentence per cell as title
       and label, a legend, and a visually hidden table with caption and headers carrying the same data
       (hidden by a block wrapper, so its 25 columns cannot widen the page); the drawn grid is decorative
       for screen readers. The read waits for the daily read to succeed and for `useMe` to say admin, and
       its key is in `PERSON_USER_LEAVES`. A footnote says the cells are recorded calls and events, not
       sign-in times, and that background calls can mark hours with no one at the screen. The summary line
       names the whole-day span (today and the 7 / 30 days before it).
     - **Switched off until measured.** The panel renders only while `USUAL_ACTIVITY_HOURS_ENABLED`
       (`apps/web/src/lib/featureFlags.ts`) is true; it ships false, so no pattern request is sent. It is
       switched on in the commit that notes in `PROGRESS.md` the owner's production `EXPLAIN ANALYZE` of this
       read for one person with a lot of activity over 30 days. If that read is slow, the fallback is to
       offer the 7-day range only. The API leaf is registered and tested either way.
- **Consequences:**
  - A new person-level label must pass `personCopy.test.tsx`; a new person-level screen must be added to it.
  - A new DTO field cannot carry a grading or ordering name; the shared test fails on it.
  - The one-day Visits link opens a list read that writes a `person_visits` access-log row, like "View visits".
  - A new read that sums `visible_ms` for a shown time must go through `creditedVisibleMs`; the
    repository test fails otherwise.
  - A viewer who follows a link to a verified person's visit sees the admins-only state; links to visits
    of anonymous or claimed-only visitors keep working for everyone. Screens open to viewers still render
    such links for verified visits: the Visits list (`features/journeys/sessionColumns.tsx`), Online now
    (`features/live/OnlineNowPanel.tsx`) and request samples (`components/requestSampleColumns.tsx`).
    Showing them as plain text for non-admins is follow-up work, pending the owner's go-ahead.
  - Opening a day writes a `person_day` row even when the day is empty (one per admin + person per 10 min).
  - Usual activity hours are built but hidden; turning them on needs the production measurement above and a
    one-line change of `USUAL_ACTIVITY_HOURS_ENABLED`, nothing else.
