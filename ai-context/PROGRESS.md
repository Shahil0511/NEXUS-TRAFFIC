# PROGRESS — living log

Newest entry first. Each implementation step (S0–S6, see the plan summary below) adds one entry:
date, what was done, files touched, what's next, known issues.

## Plan summary

| Step | Delivers |
|---|---|
| S0 | Foundation: monorepo, `@nexus/shared` contracts, `@nexus/auth`, ai-context |
| S1 | DB migrations + API skeleton + server ingest + app/key admin API + docs skeleton + Docker/compose |
| S2 | Dashboard shell + SSO + Overview / API Routes / Errors |
| S3 | Browser ingest + `@nexus/react` + Users / Journeys / Pages & Tools / Geography |
| S4 | Socket.io live + Live page |
| S5 | Reference SDK packages, snippets, tarballs, full guide, Integration Health, Apps admin UI |
| S6 | Retention/partition jobs, backups, nginx + DEPLOY.md, security suite, polish, push `main` |
| Phase A | Data quality ("data theek karna", 2026-11): items A1–A11 below, ADRs 0008–0013 |

---

## 2026-11-24 — Person 360 daily depth, step 4: migration 0014 and the visit-steps guard (ADR 0017)

Contract + migration + one service guard. The migration file is written only; deploy applies it (migrate before
the API). Nothing was run against any database.

**Done**
- **Shared** (`constants/traffic.ts`): `PERSON_ACCESS_SURFACE_VALUES` gains `person_day`, `person_pattern` (their
  reads ship in steps 5 and 6) and `person_visit_steps`. `contracts.test.ts` pins the full list.
- **Migration** `apps/api/migrations/0014_person_access_surfaces_day_pattern_visit_steps.sql`: drops and re-adds
  `person_access_log_surface_check` under the same name with the three new values, `NOT VALID` then `VALIDATE`.
  Widening only; 0013 untouched. Migrations README catalogue and table row updated; the `@see` breadcrumbs of
  `person-access-log.repository.ts`, `domain/inserts.ts`, `rows.ts` and `mappers.ts` name 0014 next to 0013.
- **API:** `JourneyService.session` — when the visit has a `user_key`, a non-admin gets `ForbiddenError`
  (403 `FORBIDDEN`, message names no person) and an admin's read is recorded as `person_visit_steps` (coalesced
  like every surface). "Has a `user_key`" does not depend on the viewer's window: when the summary has none,
  `verifiedSubjectOf` probes the same session over the window widened by `MAX_COUNT_RANGE_MS` each side (new
  repository read `WebEventQueryRepository.findSessionUserKey`, one indexed probe, same app and env), so a narrow
  custom range over the steps before sign-in still gets 403; the admin's row is then named from that wider window.
  Anonymous / claimed-only visits stay open and write no row. The route stays `...dashboard` (comment + `@see` in
  `routes/index.ts`); `PersonAccessRecorder` doc lists the new caller.
- **Web:** `SessionDetailView` shows `PersonAdminOnly` on a 403 (visit title and trail kept, "Only admins can open
  this visit", Back to People); other errors still show `ErrorState`. `PersonAdminOnly` and `isForbidden` moved
  from `UserDetailView` to `components/PersonAdminOnly.tsx` (shared by the person and visit pages); the state takes
  optional title / eyebrow / heading / description (defaults = the person-page state). Live traffic no longer
  refetches the single-visit key (`isTrafficDrivenKey` in `features/live/autoRefreshPolicy.ts`): its key cannot
  tell a verified visit, so a visit page left open adds no access-log row and a refused read is not re-sent. Privacy & access: `SURFACE_LABELS` "One day",
  "Usual activity hours", "Visit steps"; places `daily`, `daily`, `journeys` (a Visit steps row has no visit id, so
  it leads to the person's Visits list); the log panel's description mentions visit steps.
- **Tests:** `journey.service.test.ts` (verified visit: viewer 403 with no row, admin 200 with one
  `person_visit_steps` row and no second probe; verified only outside the chosen window: still 403, probe over the
  widened window, admin row named from it; anonymous and claimed-only visits open to a viewer, no row);
  `web-event-query.repository.test.ts` (`findSessionUserKey` in the READS table: bounded, env-filtered);
  `contracts.test.ts` (each person leaf maps to its own surface via a typed `SURFACE_OF_LEAF`; the leftovers are
  exactly the two narrowed lists, `person_visit_steps` and the surfaces of leaves still to come);
  `autoRefreshPolicy.test.ts` (the single-visit key is not traffic-driven);
  `person-access.routes.test.ts` (journeys.session reaches the controller for a viewer: the guard is in the
  service); web `SessionDetailView.test.tsx` (403 → admins-only state, 404 → error state), new
  `accessLogColumns.test.ts` (3 labels and places), `personCopy.test.tsx` (every surface from the enum, the visit
  admins-only state scanned). DB (CI / owner only, `RUN_DB_TESTS=1`, written, not run): schema-parity (the CHECK
  equals the enum via the existing entry, plus `convalidated` after the swap), migration-runner ledger list +0014,
  analytics-queries (J1 verified: viewer 403, admin row `person_visit_steps` with masked email; J2 claimed: open).
- Docs: ADR 0017 point 7 (window-independent check, no live refetch) + consequences, ADR 0015 (cross-references:
  the single-visit line and the no-refetch rule), `07-data-model.md`, `03-code-navigation.md`,
  `02-architecture.md` (auto-refresh exclusions).
- **Gates:** `npm run typecheck` and `npm test` green (DB suites skipped without `RUN_DB_TESTS`).

**Next / known issues**
- Deploy must run migrate (0014) before the new API: an old CHECK would refuse a `person_visit_steps` row (the
  recorder only logs a warning; the read still succeeds).
- Viewer-facing screens still link verified visits into the admins-only state: the Visits list
  (`features/journeys/sessionColumns.tsx`), Online now (`features/live/OnlineNowPanel.tsx`) and request samples
  (`components/requestSampleColumns.tsx`), plus any bookmarked link. Showing those links as plain text for
  non-admins (`useCanOpenPersonPages` when the row has a `userKey`) is follow-up work and needs the owner's
  go-ahead. (The person timeline's links are on an admin-only page.)
- Step 5: the one-day view (`users.day`, surface `person_day`).

## 2026-11-24 — Person 360 daily depth, step 3: credit cap on one `page_time` delta (ADR 0017)

Read-side change only: no contract field, no migration, no new route leaf. **It changes shipped numbers:** tab
visible time on the person, visit and page screens drops wherever a sleep gap (one huge `page_time` delta) was
credited before. Brief the owner before pushing.

**Done**
- **Shared** (`constants/traffic.ts`): `VISIBLE_DELTA_CREDIT_CAP_MS = 12 * SDK_DEFAULTS.browser.flushIntervalMs`
  (60 000). `contracts.test.ts` pins it. The `@nexus/react/early` bundle still tree-shakes `SDK_DEFAULTS` away
  (checked with a scratch build: 8043 B, no `flushIntervalMs` in it).
- **API:** `creditedVisibleMs(alias)` in `apps/api/src/db/sql.ts` — `CASE WHEN visible_ms > cap THEN cap ELSE
  visible_ms END` (NULL stays NULL; LEAST would credit the cap to API rows). Applied at all four sum sites of
  `WebEventQueryRepository` (a grep found no other `sum(… visible_ms …)` in any repository): `pageViewVisibleMs`
  (`pt`; person timeline, visit steps), `sessionStatsStatement` (`w`; Visits list, visit header),
  `pageStatsStatement` (`w`; Pages avg / p50, one page), `listUserDailyActivity` (`h`). The stored value is not
  changed.
- **Web:** `METRIC_COPY.activeTime` and `METRIC_COPY.visibleTime` say one stretch without a tick counts at most 1
  minute (`activeTime` short / long reworded to stay within the 260-character tooltip limit; "API calls add no
  time" stays in "About these numbers"); "About these numbers" gains the line on both views. The visit screens
  now show that tooltip too: `info={metricInfo('visibleTime')}` on the visit header's Visible time card
  (`SessionDetailView.tsx`) and `hint` on the Visits list's Visible column (`sessionColumns.tsx`), as on Pages and
  one page.
- **Public guide** (`docs/integration/03-browser-contract.md`): the page-time recipe now lists the visible tick
  (`reason: "idle"` every `{{BROWSER_TICK_SECONDS}}` s, what the reference SDK does) and states that one delta
  counts at most `{{VISIBLE_CREDIT_CAP_SECONDS}}` s. Both tokens come from the shared constants
  (`scripts/build-docs.ts`, checked in `test/docs-build.test.ts`). `docs/CHANGELOG.md` gains a dated
  "dashboard read change" entry (the guide's visible tick; the 60 s credit, stored values unchanged, reference SDK
  1.0.0 / 1.1.0 unaffected, a tracker sending one long delta per view now credited at most 60 s per delta).
- **Tests:** `db/sql.test.ts` (new: exact CASE, NULL-safe shape, no LEAST); repository test pins the CASE at all
  four sites (timeline, visit list + header, page list + detail, daily), and for EVERY read fails on any
  sum / avg / min / max / percentile / LEAST / GREATEST whose argument reads a raw `visible_ms` once the credited
  CASE is stripped (`rawVisibleArguments`: balanced-paren argument scan, so `sum(visible_ms)`, casts and
  `coalesce(…)` are caught; only avg / p50 over the page stats CTE `t` is allowed; a self-test pins those
  spellings); the pinned daily `active_ms` string updated. Web: metric copy, the caveat line on both views, and the
  Visible time tooltip (with the 1-minute line) on the visit header and the Visits list. DB (CI / owner only,
  `RUN_DB_TESTS=1`): new `test/db/visible-credit-cap.integration.test.ts` with the S5 seed (`seedVisibleCreditCap`: a 3 h delta + a 4 s
  tick + an API row in one visit → 64 000 ms on the person day, visit list, visit header and page view, page avg /
  p50; the API row is not credited).
- Docs: ADR 0017 (point 6, consequences; "About these numbers" bullet re-wrapped), `07-data-model.md`,
  `03-code-navigation.md`, `GLOSSARY.md`, `docs/CHANGELOG.md`. Repository doc comments (file header,
  `pageViewVisibleMs`, `sessionStatsStatement`, `listUserDailyActivity`, `listPageStats`) now say Σ credited
  visible_ms with `@see ../db/sql.ts creditedVisibleMs` (header also links ADR 0017).
- **Gates:** `npm run typecheck` and `npm test` green (DB suites skipped without `RUN_DB_TESTS`).

**Next / known issues**
- Owner brief (Hinglish) before the push: sleep gaps no longer count as tab visible time, so some older person,
  visit and page numbers go down; trackers that tick normally are unaffected.
- A hand-rolled browser tracker that skips the visible tick (one delta per view) is now credited at most 60 s per
  delta; the guide says so. Apps on the reference SDK tick every 5 s.
- Step 4: migration 0014 + the visit-steps guard.

## 2026-11-24 — Person 360 daily depth, step 2: per-app split of each day and a per-day chart (ADR 0017)

Contract change, no migration, no new route leaf. Tab visible time is still the plain Σ of `visible_ms` (the
per-tick credit cap is step 3).

**Done**
- **Shared contract** (`packages/shared`): new `UserDayAppActivityDto`; `UserDayActivityDto.perApp` (ordered by the
  app's first activity, then slug; the day's counts and tab visible time are its Σ, `apps` its sorted slugs). New
  `USER_DAILY_APP_ROWS_LIMIT = 3000` in `constants/traffic.ts` (`contracts.test.ts` checks it covers the widest
  window × many apps).
- **API:** `WebEventQueryRepository.listUserDailyActivity` keeps the same bounded, keyed UNION ALL but groups by
  `(day, app)` (`GROUP BY 1, 2`, `ORDER BY 1 DESC, 3 ASC, 2 ASC`, no `array_agg`), `LIMIT` bound to the cap + 1.
  `domain/rows.ts`: `UserDayAppActivityRow` replaces `UserDayActivityRow`. `domain/mappers.ts`:
  `mapUserDayAppActivity`, `dropTruncatedOldestDay` (drops the whole oldest day when the extra row came back),
  `foldUserDays` (replaces `mapUserDayActivity`). `UserService.daily` only changes its mapping line; window
  widening, 93-day cap and the `person_daily` access-log row are unchanged.
- **Web** (`features/users/`): new `DayAppList.tsx` — one line per app in first-use order (AppChip, its tab visible
  time or "no browser time" for an app seen only through API calls, muted first–last clock), at most three lines,
  then a `+N more` button (`aria-expanded`, local state, no fetch). New `components/charts/DailyBarChart.tsx` and the
  "Tab visible time per day" panel in `UserDaysOverview.tsx` (one bar per IST day of the window, gap-filled with 0,
  one colour, no reference line; tooltip: date, tab visible time, first – last activity, apps; hidden without
  active days). `ChartTooltip` takes optional `notes` lines. `dailyActivity.ts`: `visibleAppLines`,
  `appTimeLabel`, `appClockSpan`, `fillReportingDays`, `trendPointNotes`. `metricCopy.dayApps` explains the per-app
  lines.
- **Tests:** mapper fold / truncation cases, service fold + cap, repository SQL shape (`GROUP BY 1, 2`, limit
  value, no `array_agg`, pinned `active_ms`), web helpers, the tab (app order, "no browser time", `+1 more`
  expands without a read, chart shown / hidden), `ChartTooltip` renders the hovered day's notes (none without
  `notes`). Web fixtures build every day with `userDayFrom` (`src/test/fixtures.ts`), which folds a day from its
  `perApp` the way `foldUserDays` does, so a test day can never disagree with its own apps. DB (CI / owner only,
  `RUN_DB_TESTS=1`): new `test/db/user-daily.integration.test.ts` with the S4 seed (`seedUserDailyApps`: two apps
  in first-use order ≠ slug order, per-app visits, an API-only day, the app filter); the S3 daily expectation
  gains `perApp`.
- Docs: `07-data-model.md` (per-person daily rows), `03-code-navigation.md`, `GLOSSARY.md`, ADR 0017 (point 5).
- **Gates:** `npm run typecheck` and `npm test` green (DB suites skipped without `RUN_DB_TESTS`).

**Next / known issues**
- Step 3: the read-side credit cap on long `page_time` deltas at all four sum sites (brief the owner before
  pushing: some shipped tab-visible numbers drop).
- `appTimeLabel` shows "no browser time" only for an app with API calls and NO browser visit that day; an app
  with visits but no `page_time` yet shows "0 min" (it does have the browser tracker).
- Not yet checked in the running app at 1280 px with several app lines per row, or on a phone.

## 2026-11-24 — Person 360 daily depth, step 1: neutral labels, one-day Visits link, stated limits (ADR 0017)

Web and shared tests only; no API, contract or database change.

**Done**
- **New [ADR 0017](decisions/0017-person-daily-depth.md)** (first version): the owner's call to go deeper into
  per-person, per-day facts under the ADR 0015 safeguards; the neutral label list and where the banned words live;
  the definitions of tab visible time, time in app and activity blocks; what later steps add. ADR 0014 / 0015,
  `02-architecture.md`, `03-code-navigation.md`, `04-how-to-recipes.md`, `07-data-model.md` and `GLOSSARY.md`
  point at it.
- **Daily activity tab** (`features/users/`): `UserDailyActivityTab.tsx` is now a thin entry for
  `UserDaysOverview.tsx`; columns moved to `userDailyColumns.tsx` (`dailyColumns(userKey, linkQuery)`, memoised) and
  the day bar to `DayStrip.tsx`. Totals read Active days / Tab visible time ("added up over the active days"); the
  row shows Tab visible time, its apps as `AppChip`s, "Pages and calls" (page views, feature uses, API calls ·
  failed) and the visit count as a link to Visits for this person and that one IST day (`dayVisitsQuery`:
  `userKey` + `range=custom` midnight to midnight + app / env; the read is the existing admin-only, logged
  `person_visits`). The list ends with "End of list · N days" and an "About these numbers" panel
  (`AboutTheseNumbers.tsx`, static caveats). `dailyActivity.ts`: `activeDays` / `totalTabVisibleMs` renames,
  `dayWindowQuery`, `dayVisitsQuery`, `countLabel`.
- **Labels elsewhere:** identity card First activity / Last activity; the visit page heads its steps "Visit steps"
  (panel and list name), and the person timeline's link says "Visit steps". `lib/metricCopy.ts`: `activeTime` is
  "Tab visible time" (its text says it is not keyboard or mouse use and two visible tabs both count),
  `daysActive` is "Active days", new `dayApps`, `dayCounts`, `dayVisits` (`featureUses` comes with the one-day
  view that shows it). The Visits page copy and the timeline link icon (a list, not a play button) say visit
  steps too, so the drill-down uses one name.
- **Safeguard tests:** `lib/neutralCopy.ts` (`NEUTRAL_COPY_BANNED`, `findBannedWords`, `collectRenderedText`; test
  only) with `neutralCopy.test.ts`; `features/users/personCopy.test.tsx` renders every person page tab, the
  identity card, the admins-only state, the visit page and Privacy & access and finds no banned word in text,
  aria-labels, titles, alt or placeholders; `metricCopy.test.ts` checks every label and definition;
  `packages/shared/src/dto-safeguards.test.ts` reads the DTO sources and fails on a grading or ordering field name.
  New `features/users/UserDailyActivityTab.test.tsx` (labels, chips, counts, Visits href bounds, end marker,
  caveats, empty state).
- **Gates:** `npm run typecheck` and `npm test` green (DB suites skipped without `RUN_DB_TESTS`).

**Next / known issues**
- Step 2: per-app split of each day and the tab-visible-time-per-day chart (contract change, no migration).
- The Date column is still plain text; it links to the one-day view once that view exists.
- Not yet checked in the running app at 1280 px (the six columns must fit without sideways scroll) or on a phone.

## 2026-11-24 — Docs in line with the English-only, icons and illustrations passes (ADR 0016)

Docs-only step over the three uncommitted UI passes below (English-only copy; page icons and art; one name
per thing). No code behaviour changed.

**Done**
- **New [ADR 0016](decisions/0016-english-only-ui-icons-and-illustrations.md):** screen copy is English only
  (`NavItem.questionHi` removed); every hero shows its section's icon tile and list pages a small illustration
  (`NAV_ILLUSTRATIONS`); empty, error, admins-only, no-access and not-found states open with `StateArt`; art is
  inline SVG through `IllustrationFrame` (aria-hidden, token colours only, motion-safe) rather than raster images;
  `formatOsName` prints every macOS form as "macOS" at display time (stored `ua_os` unchanged).
- **[ADR 0014](decisions/0014-object-first-navigation-and-person-page.md)** (where `questionHi` was introduced,
  decision 2) carries a "Superseded in part by ADR 0016" line.
- **ai-context:** `02-architecture.md` lists ADR 0016; `03-code-navigation.md` page frame cites ADR 0016 and notes
  `formatOsName` and `withUnit`; `04-how-to-recipes.md` "Add a dashboard metric or page" now asks for an English
  `question`, an `icon`, a `NAV_ILLUSTRATIONS` entry and points at `apps/web/src/components/illustrations/`;
  `GLOSSARY.md` has "page hero" and "illustration / state art".
- **Comment fix:** `components/illustrations/index.ts` no longer says detail pages show their section's motif
  (they keep the icon tile only, as `PageHeader` does).
- **Gates:** `npm run typecheck` and `npm test` green (DB suites skipped without `RUN_DB_TESTS`); the ai-context
  link test passes with the new paths.

**Next / known issues**
- The public guide (`docs/integration/01-getting-keys.md`, `11-troubleshooting.md`) still says "Apps page" and
  "Integration page" for the screens now called App keys and Data health.
- Still unchecked in the running app: both themes, a 360px phone and a 1280px laptop.
- The three UI passes and this docs step are uncommitted.

## 2026-11-24 — Phase B polish: one name per thing, layout and a11y fixes from the UI review

Builds on the two uncommitted passes below (English-only copy; page icons and art).

**Done**
- **Page names:** copy that sends the reader to another page reads the sidebar label (`navLabel` in `lib/nav.ts`):
  key, base path and origin fixes point at the "App keys page" (`integrationCopy.ts`, `AppHealthCard`,
  `IntegrationView`); metric tips and buttons say People, Data health and Apps (`lib/metricCopy.ts`,
  `WidenRangeButton`, the app page). "Geography" became "places".
- **One name per thing:** routes are "request types" on screen (Request types list column, detail fallback title
  and crumb, "Top failing request types", "Most used request types", command palette group); the list header
  says each row is one API route. The visit page says "Visit", "visit id", "Visit metrics" and "Person page";
  the Visits column is "Entry → exit". The requests metric is "API calls" everywhere
  (`METRIC_COPY.requests.label`: KPIs, columns, Live, Places, Devices share-of switch). The command palette groups
  are Go to, Apps, People, Request types.
- **Neutral, accurate wording:** "Verified people, by API calls" (app page), "Who calls it" (request type page),
  "People affected" (Problems); the Places switch is "Show countries by" / "Show by …".
- **Plain words:** chart descriptions say "per minute / hour / day" (`perGrain` in `lib/format.ts`) instead of
  "per bucket"; "Most failed requests" replaces "4xx + 5xx"; Live KPIs carry the p95 and "Active users now" tips;
  empty states drop SDK event names and link the guide (`components/GuideLinkButton.tsx`). Pages columns are
  "Average visible" / "Median visible" with the visible-time tip.
- **Layout:** Privacy and Data health grids are `grid-cols-1` below xl (tables no longer push a phone sideways);
  the Apps table shows p95, Visits, Tool uses and Linked from 2xl only (`SECONDARY_COLUMN`, DataTable skeletons
  follow column classes) and the Application column keeps `min-w-48`; the identity card sticks below the top bar
  (`--spacing-topbar` token); tab rows wrap below sm; the Apps used table has cell gaps and its own scroll.
- **A11y:** the unavailable Devices panel has a dashed outline instead of `opacity-70` (AA contrast); the day strip
  is aria-hidden (times are printed above it); "+N" app counts name the hidden apps for screen readers; the tab
  list is "Person page sections"; detail-page titles wrap and get no hero motif.
- **Person page:** a no-activity 404 no longer shows "Could not load these facts" in the identity card, and the
  failure line no longer points at a Devices tab that is not on screen.
- **Access log:** `person_profile` is labelled "Identity card and Summary" (it is sent on every open); ADR 0015 §4
  says so.
- **Tests:** `components/StateArt.test.tsx`, `components/AppChip.test.tsx`, `appTrafficColumns.test.ts`;
  illustrations test checks class utilities against a token allowlist and iterates `STATE_ILLUSTRATIONS`;
  `navLabel` and `perGrain` tests; updated view tests for the new names.

**Next / known issues**
- The public guide (`docs/integration/01-getting-keys.md`, `11-troubleshooting.md`) still says "Apps page" and
  "Integration page" for the dashboard screens now called App keys and Data health.
- Look at both themes, a 360px phone and a 1280px laptop in the running app.

## 2026-11-24 — Phase B polish: page icons, illustrations, state art, panel icons, Libas favicon

Builds on the uncommitted English-only copy pass of 2026-11-23 (NavItem.questionHi removed, OnlineBadge,
withUnit / "Not yet", "macOS", identity card stacking, People / Visits column names).

**Done**
- **Page hero:** `components/PageHeader.tsx` shows the nav item's icon in a plum gradient tile left of the title
  and, from md up, the section's illustration on the right. Both are aria-hidden and follow the active nav item,
  so person, app, page and tool detail pages wear their section's art. The hero top line now uses the new
  `--brand-from` / `--brand-to` tokens instead of hard-coded hex.
- **Illustrations:** `components/illustrations/` holds one small inline-SVG motif per nav item (charts, pulse,
  people, path, devices, apps, pages, request routes, problems, data health, keys, shield) plus state art (empty
  box, warning cloud, lock, compass). `IllustrationFrame` makes every SVG aria-hidden and non-focusable; colours
  come only from token utilities, so light and dark both work. The Live beacon pings only under `motion-safe`.
  `NAV_ILLUSTRATIONS` is a `Record<NavItemId, …>`; `NavItemId` is a new union type in `lib/nav.ts`.
- **States:** `components/StateArt.tsx` (scene + badge with the state's own icon) now opens `EmptyState`,
  `ErrorState` (and its too-long-range state), `AdminOnly`, `NoAccess` and `app/not-found.tsx`. Visible text is
  unchanged.
- **Panel icons:** `Panel` takes an optional `icon` (size-4, muted, aria-hidden). Used on the major panels of
  Overview, Live (incl. Who's online now), Devices & places (one icon per dimension in `DEVICES_DIMENSION_COPY`,
  first-time vs returning, countries, cities), the person page tabs and Privacy & access.
- **Favicon:** `app/icon.svg` is a plum gradient rounded square with a white "L" mark.
- **Tests:** `components/illustrations/illustrations.test.tsx` (every nav id has art, all art is aria-hidden with
  no text and no raw colours), `components/PageHeader.test.tsx` (icon tile, md+ art, detail pages, pages outside
  the nav), a Panel icon test, and a brand-tile contrast check in `app/designTokens.test.ts`.

**Next / known issues**
- ADR 0014 still says the hero prints an English and a Hinglish sentence; the screens are now English only. An
  ADR recording the English-only decision is still to be written (owner's call).
- Look at both themes and a 360px phone in the running app once the local api is up.

## 2026-11-23 — Phase B polish: Libas logo, light by default, light sidebar, cursor spotlight, new names in trails

**Done**
- **Libas logo** in the sidebar and the mobile menu: `components/LibasLogo.tsx` draws
  `public/brand/libas-logo.png` (the Libas wordmark, white on transparent, the same file the Libas Leaderboard
  uses) as a CSS mask filled with `currentColor` (`text-sidebar-title`), so one file is plum on the light sidebar
  and white on the dark one. The URL carries `PUBLIC_BASE_PATH`.
- **Light theme by default:** `AppProviders` sets `defaultTheme="light"`; dark and "system" stay in the theme
  toggle.
- **Light sidebar in the light theme:** `--sidebar*` tokens in `:root` are now white / plum; the plum rail stays
  in `.dark`. New tokens `--sidebar-hover-foreground`, `--sidebar-title`, `--sidebar-indicator`,
  `--sidebar-glow` replace the hard-coded `text-white` / `#e58ad9` / glow colour in `AppShell` and `MobileNav`.
- **Cursor spotlight:** `components/CursorSpotlight.tsx` (mounted once in `AppProviders`) lights every Card
  (`[data-slot="card"]`) and the page hero (`data-spotlight`) with a soft purple radial light under the mouse;
  the light is an `::after` in `globals.css` (`--spot-inner` / `--spot-outer` per theme). One passive
  `pointermove` listener, one write per frame; fine pointers only, off under prefers-reduced-motion.
- **New names everywhere:** breadcrumbs (Apps, Request types, People, Visits) and browser-tab titles of every page
  now match the nav (People, Visits, Devices & places, Apps, Pages & features, Request types, Problems,
  Data health, App keys). The `person-access.recorder.ts` header now names all three callers.
- **Local dev note:** a stale `apps/web/.next/dev` Turbopack cache made `next dev` fail with
  "Can't resolve '@vercel/turbopack-next/internal/font/google/font'" (`next build` was fine). Deleting
  `apps/web/.next/dev` fixed it.

**Next**
- Look at the light sidebar, logo and spotlight with real data once the local api is up (it needs the dev DB).

## 2026-11-23 — Phase B steps 2-4: Devices & places, Person 360 with daily activity, admin-only person pages and access log

Closing entry for Phase B steps 2–5 (the per-step entries below hold the details). Records the two ADRs,
the docs that were brought back in line, and a completeness check of the tree against what the steps set out
to deliver.

**Done**
- **ADRs:** new [ADR 0014](decisions/0014-object-first-navigation-and-person-page.md) (object-first nav groups,
  page hero + page end, the `today` preset with `elapsedTo`, Devices & places, Person 360 tabs on the global
  range, neutral labels). The step 5 ADR is renumbered to
  [ADR 0015](decisions/0015-admin-only-person-pages-and-access-log.md) and widened: which leaves are admin-only
  (`PERSON_ROUTE_LEAVES`, `PERSON_FILTERED_ROUTE_LEAVES`, `privacy.accessLog`), the `traffic.person_access_log`
  table, recording, in-memory coalescing (10 min per admin + person + surface) and masking (`maskEmail`, CHECK on
  the stored form). Every link to the old file name now points to 0015.
- **Docs made true again:** `02-architecture.md` (auto-refresh skips `privacy` and person-level keys; Phase B ADR
  list), `03-code-navigation.md` (People link admins only, Visits `?userKey=` from "View visits", the page frame:
  `NAV_SECTIONS`, `PageHeader`, `PageEndProvider` / `PageEnd`, the `today` window helpers), `04-how-to-recipes.md`
  (how to add a person-level read; nav `question` / `questionHi`; `LoadMoreButton` for paged lists),
  `07-data-model.md` (the narrowed lists also write access-log rows; active time = Σ `visible_ms` per IST day),
  `GLOSSARY.md` (visit, person page, daily activity, active time, access log, surface, today, page end).
- **Completeness check** (tree vs. the plan): Devices & places page (`/devices`, two tabs, share switch,
  `ProportionBar`) — present. Person 360 (identity card; Summary, Daily activity with first / last activity and
  active time (tab visible), Devices, Activity tabs; global range incl. Today) — present. Person leaves admin-only on
  the server, plus `?userKey=` narrowing — present, with route tests. Access log table (0013), endpoint
  (`privacy.accessLog`) and Privacy & access page (`/privacy`) — present. `today` preset — present.
- **Gates:** `npm run typecheck` green; `npm test` green (auth 10, express 59, node 119, react 140, shared 71,
  api 1122 passed / 266 skipped (DB suites), web 450).

**Next**
- Run `RUN_DB_TESTS=1 npm run test:db` and `npm run test:smoke` where Docker is available: **neither was run for
  steps 1–5** (no Docker on this laptop). The new DB blocks (daily activity, devices, latest context, access-log
  coalescing / masking / paging / append-only, privileges, schema parity, migration list) and the e2e checks are
  written but unproven against Postgres.
- Review the person page and Devices & places on the deployed stack with real data.

**Notes / known issues**
- A viewer who opens `/journeys?userKey=` or `/errors?userKey=` directly sees the API's 403 as a generic error state.
- Devices & places loads all bars together (not the first three first); the access log is not pruned by any job.
- The identity card's first / last seen are within the selected range (no lifetime read); devices are grouped by
  User-Agent facts, not by the tracker's device id.
- No ESLint config in the repo, so lint was not run.

## 2026-11-23 — Phase B step 5: review fixes (today window, whole days, person-level reads, page end)

Fixes from the review of steps 1–4. New [ADR 0015](decisions/0015-admin-only-person-pages-and-access-log.md)
(person-level reads are admin-only and access-logged; supersedes the ADR 0001 role split).

**Done**
- **`today` compares like with like:** `resolveTimeWindow` returns `elapsedTo` (now, clamped into the
  window). A running window is compared with the same elapsed span before it (today 00:00–10:00 vs
  yesterday 00:00–10:00), so KPI deltas no longer read as a drop. `bucketStarts` (and with it
  `fillTimeseriesGaps` / `fillCountGaps` / `fillToolTrendGaps`) stops at the current bucket: hours
  that have not happened yet are no longer drawn as zeros.
- **Daily activity over whole IST days:** `wholeReportingDays` (`packages/shared/src/time-window.ts`);
  `UserService.daily` widens the window (and echoes it widened), so a rolling range no longer cuts its
  oldest day. `UserDayActivityDto.inProgress` flags today; the tab shows its last activity as "so far"
  and leaves it out of the average last activity.
- **Person-level reads:** `PERSON_FILTERED_ROUTE_LEAVES` (`journeys.sessions`, `errors.summary`,
  `errors.list`, `live.online`) are admin-only with `?userKey=` (`requireAdminForUserKey`); the
  sessions / failure reads record `person_visits` / `person_failures` (new surfaces, 0013 CHECK
  updated — 0013 was never deployed). The identity card's `latest` facts moved from `users.devices`
  to `users.profile`, and the Devices tab sends its read only while open, so opening the page no longer
  records a Devices view. Person-level and access-log queries are no longer refetched by live traffic.
  `PersonAccessRecorder` waits for a running attempt with the same key and records itself when that one
  wrote nothing (no lost rows on a race or a failed INSERT).
- **Web:** person links (People rows and their failed count, command palette user results, session
  replay "User profile", `UserLink`) show for admins only (`useCanOpenPersonPages`); the People purpose
  line no longer promises a person page. `PageEnd` says "Still loading…" during a first load and points
  to "Load more" while a list has more rows (`PageEndProvider`, `LoadMoreButton`).
- **Docs:** ADR 0015; ADR 0001 row, `01-project-overview.md`, `GLOSSARY.md`, `03-code-navigation.md`,
  `07-data-model.md`, `docs/integration/05-pii.md`.
- **Tests:** shared window cases (mid-day today, whole days), gap filling of a running window, recorder
  races, guard middleware, narrowed routes 403/200, service recording, mappers, web non-admin cases,
  auto-refresh policy, PageEnd. DB blocks updated (daily window, profile `latest`), not run here.

**Next / known issues**
- Run `RUN_DB_TESTS=1 npm run test:db` where Docker is available.
- A viewer who opens `/journeys?userKey=` or `/errors?userKey=` directly gets the API's 403 as an error
  state (no dedicated page state yet).

## 2026-11-23 — Phase B step 4: person pages admin-only + person access log + Privacy & access page

Contract → migration → api → web → docs. The person page and its four reads become admin-only, every
admin open is recorded (coalesced) in a new append-only table, and admins can read that log on a new
page.

**Done**
- **Contract:** `PERSON_ROUTE_LEAVES` (`users.profile`, `users.timeline`, `users.devices`,
  `users.daily`) in `packages/shared/src/routes.ts`; `ROUTES.privacy.accessLog` (GET
  `/v1/privacy/access-log`); `privacyAccessLogQuerySchema` (cursor + limit + optional `userKey`,
  `packages/shared/src/schemas/privacy.ts`); `PersonAccessEntryDto` (`packages/shared/src/dto/privacy.ts`);
  `PERSON_ACCESS_SURFACE_VALUES` + `PERSON_ACCESS_COALESCE_MS` (10 min) in `constants/traffic.ts`.
- **Migration [0013](../apps/api/migrations/0013_person_access_log.sql):** `traffic.person_access_log`
  (id identity, `viewed_at`, `viewer_email`, `subject_user_key` bytea(32), `subject_email_masked` with a
  masked-form CHECK, `surface` CHECK mirroring the shared enum), indexes on `(viewed_at, id)` and
  `(subject_user_key, viewed_at, id)`, triggers refusing UPDATE / DELETE / TRUNCATE for every role.
  `grants.ts`: `SELECT, INSERT` only, plus an explicit REVOKE of UPDATE / DELETE / TRUNCATE.
- **API:** the four person leaves use `...admin` (403 `FORBIDDEN` envelope for non-admins, before any
  read). `UserService.profile / timeline / devices / daily` take the viewer and, after a successful
  read, call `PersonAccessRecorder.record`. Coalescing is an in-memory TTL map
  (`PersonAccessCoalescer`): repeats cost no database round trip; a restart or a second replica can only
  add a duplicate row, never lose one. The person is named by `maskEmail` of their newest email in the
  read's window (`WebEventQueryRepository.findUserEmail`); no event there → no row. A failed write logs
  `person access log write failed` with the surface and pg code only, and the read still answers.
  `PrivacyController.accessLog` → `PrivacyService.accessLog` → `PersonAccessLogRepository.list`
  (WRITE pool, newest first, keyset `(viewed_at, id)`, `no-store`).
- **Web:** the person page checks `useMe` first: a non-admin (or a 403 from the API) sees "Only admins can
  open a person's page" with a link back to People, and no person read is sent. `components/AdminOnly.tsx`
  gained optional `heading`, `hint`, `eyebrow`, `action`. New page `/privacy` (`PAGES.privacy()`, nav
  Setup → "Privacy & access", "Who opened whose person page, and when." / "Kisne kiska page kab khola."):
  access-log table (when, admin, person masked, part of the page linking to that tab), "Load more",
  "Only this person" (`?userKey=`), and the "What this dashboard records" list. Non-admins see the
  admins-only state and the log is never requested.
- **Tests:** `apps/api/test/person-access.routes.test.ts` (403 vs 200 per person leaf with the real guards,
  access log admin-only, lists open), recorder / coalescer / privacy service / repository SQL-shape unit
  tests, READS entry for `findUserEmail`, UserService access tests, shared contract checks, web view tests
  (person page non-admin state and 403, PrivacyView) and nav tests. Written, not run here (no Docker):
  DB blocks in `analytics-queries.integration.test.ts` (coalescing, masking, paging, append-only for both
  roles, masked CHECK), privileges, schema parity, migration list, e2e (403 / 200 per leaf, access log).

**Next / known issues**
- Run `RUN_DB_TESTS=1 npm run test:db` where Docker is available.
- Links to a person page (e.g. `UserLink`) still show for non-admins; they lead to the admins-only state.
- The access log is not pruned by any job; it is small (coalesced, admins only).

## 2026-11-23 — Phase B step 3: Person 360 (identity card, tabs, daily activity, devices)

The user detail page `/users/[userKey]` becomes a person page over the GLOBAL range (Today
included). Contract → api → web; no migration (all columns exist since 0004 / 0005 / 0007).

**Done**
- **Contract:** `ROUTES.users.devices` (GET `/v1/users/:userKey/devices`) and `ROUTES.users.daily`
  (GET `/v1/users/:userKey/daily`), query schemas `userDevicesQuerySchema` / `userDailyQuerySchema`
  (= `timeWindowQuerySchema`: window + app + env), `USER_DEVICES_LIMIT` (50), DTOs
  `UserDevicesDto` (`UserDeviceDto[]` + `latest: UserLatestContextDto | null`) and
  `UserDailyActivityDto` (`WindowedListDto<UserDayActivityDto>`) in `packages/shared/src/dto/users.ts`.
- **SQL** (`WebEventQueryRepository`, filtered by `user_key` like the profile, window + env on every
  table): `listUserDevices` (both tables grouped by `ua_device, ua_browser, ua_os`, newest first;
  visits = distinct BROWSER sessions), `getUserLatestContext` (the single newest browser event:
  device, browser, OS, `client_tz`, `client_lang`, `release`), `listUserDailyActivity` (IST day
  bucket = `bucketExpr('day')`, same as DAU; first / last activity = min / max over both tables;
  active time = Σ `visible_ms` of the day's `page_time` rows; failed = status >= 400; newest first,
  idle days absent). Both leaves are bounded by `MAX_COUNT_RANGE_MS` and answer an empty list (not
  a 404) when the person did nothing; the profile keeps the 404.
- **Service / controller / route:** `UserService.devices` / `.daily`, `UserController.devices` /
  `.daily`, wired in `http/routes/index.ts`; mappers `mapUserDevice`, `mapUserLatestContext`,
  `mapUserDayActivity`.
- **Web:** `api.users.devices` / `api.users.daily`, keys `qk.users.devices` / `qk.users.daily`,
  hooks `useUserDevices` / `useUserDaily`. `UserDetailView` = header (breadcrumb, "View failures",
  "View visits") + a left identity card that stays on screen (`PersonIdentityCard.tsx`: email with
  copy, Online now, apps, first / last seen in the range, latest known device with icon, browser,
  OS, time zone, language, app version) + tabs in the URL (`?tab=`, `userDetailParams.ts`):
  Summary (`UserSummaryTab.tsx`, the former KPIs and lists), Daily activity
  (`UserDailyActivityTab.tsx`: totals for the range, one row per day with a 00:00-24:00 IST strip),
  Devices (`UserDevicesTab.tsx`), Activity (`UserActivityTab.tsx`, the timeline). Pure helpers
  `dailyActivity.ts` (strip position, averages, totals) and `personFacts.ts` (device label / icon,
  initials); `formatHoursMinutes` ("3 h 12 min"), `formatClockTime`, `formatClockOffset`,
  `formatDay` in `lib/format.ts`; metric copy `activeTime`, `firstActivity`, `lastActivity`,
  `daysActive`.
- **Tests:** `user.service.test.ts`, `mappers.test.ts`, repository SQL shape + READS table,
  `routes-contract.test.ts` (literal `/v1/users/<word>` leaves before `/:userKey`; person leaves
  validated), DB blocks in `test/db/analytics-queries.integration.test.ts` and
  `test/e2e/dashboard.integration.test.ts`, web view tests (tabs, card, daily, devices) and helper
  tests.

**Next**: owner review of the person page.

**Notes / known issues**
- The DB / e2e suites were written but not run (no Docker on this laptop).
- The identity card's "first / last seen" are in the selected range (the profile); there is no
  range-free lifetime read.
- Devices are grouped by User-Agent facts, not by the tracker's device id.

## 2026-11-23 — Phase B step 2 (B1c): Devices & places page

New page `/devices` (`PAGES.devices`) on the existing read endpoints; no contract, migration or API change.

**Done**
- **Page:** `app/(dashboard)/devices/page.tsx` → `features/devices/DevicesView.tsx`. Two tabs kept in
  the URL (`?tab=`, nuqs, `features/devices/devicesParams.ts`): "Devices & browsers" (device type,
  browser, operating system, app version, first-time vs returning devices via `DeviceReturnPanel`)
  and "Places" (time zone and language bars, then the countries / cities content).
- **"Show share of" switch** (`?share=`): Page views (browser events, the default) or Requests
  (`source=server` on `overview.breakdown`). Dimensions the server source lacks (time zone,
  language) are greyed out with no request and offer "Show share of page views"
  (`features/devices/shareOf.ts`, from `SERVER_BREAKDOWN_DIMENSION_VALUES`). On the Places tab the
  country chart follows the same switch.
- **`components/ProportionBar.tsx`**: labelled horizontal bars whose label always carries the unit
  ("30% of page views"), width = share of the whole total, an "All other values" bar for what the
  top list leaves out, Libas colour tokens, a screen-reader table with the same rows;
  `ProportionTable` is the visible "Show all values" dialog (fetched on open, up to
  `BREAKDOWN_LIMIT_MAX`). Pure helpers in `components/proportionShares.ts`. In-page tabs:
  `components/ui/tabs.tsx` (Radix Tabs, inactive tabs unmount and send no queries).
- **Places:** the Geography content moved into `features/geography/GeoPlacesSection.tsx` (used by
  `/geography` and the Places tab). The "no location" notice now says the status, the cause (every
  request reaches Nexus from the gateway's internal address) and links Data health.
- **Nav:** the "Devices & places" item (id `devices`) points to `PAGES.devices()` with
  `alsoActiveOn: [PAGES.geography()]`; `/geography` keeps working.
- Tests: `features/devices/DevicesView.test.tsx` (MSW), `features/devices/shareOf.test.ts`,
  `components/ProportionBar.test.tsx`, `components/proportionShares.test.ts`, `lib/pages.test.ts`.

**Next**: Person 360 with daily activity.

**Notes / known issues**
- `npm run test:smoke` and the DB suites not run (no Docker on this laptop); no API change.
- Bars load together (5 queries on the Devices tab), not three first.

## 2026-11-23 — Phase B step 1: "Today" range, Libas look, object-first menu, page hero and page end

First visible step of the Phase B redesign (web + one contract value).

**Done**
- **Contract:** `RANGE_VALUES` gains `today` = the current IST calendar day, 00:00 up to the next
  00:00 (the window ends in the future so a chart shows the whole day; the previous window is
  yesterday). `resolveTimeWindow` + `startOfReportingDay` in `packages/shared/src/time-window.ts`,
  `REPORTING_UTC_OFFSET_MS` in `constants/time.ts`; test in `contracts.test.ts`. The web picks it up
  through `RANGE_VALUES` (range picker "Today" chip, command palette action).
- **Look:** Libas brand tokens in `apps/web/src/app/globals.css` (logo purple `#71006a` / orchid
  `#e58ad9` in dark, blush-white page with two soft glows, deep plum sidebar in both modes, new
  `sidebar-muted` / `sidebar-hover` tokens), Rajdhani for `h1` / `h2` and KPI numbers
  (`--font-heading`, `app/layout.tsx`), softer cards with a hover lift (`components/ui/card.tsx`).
  Contrast guard still green (`--destructive` and `--method-post` darkened for the blush page).
- **Menu:** `lib/nav.ts` grouped by object (top: Overview, Live; People: People, Visits, Devices &
  places; Apps: Apps, Pages & features, Request types, Problems; Setup: Data health, App keys).
  Ids and URLs unchanged. Every item has `question` + `questionHi` (English + Hinglish purpose).
  Page `h1`s follow the new names (smoke test: "App keys").
- **Page hero:** `components/PageHeader.tsx` is a hero band; on a list page it prints the nav
  item's purpose sentence in English and Hinglish.
- **Page end:** new `components/PageEnd.tsx`, rendered by `AppShell` under every page: "End of
  <page>" divider, the colour legend (red failed, amber slow, green live, purple click), IST note,
  "Back to top". Owner feedback: "scroll karne par pata nahi chalta page kab khatam hota hai".
- Checked in Chrome on a local `next build` + `next start` (no Docker on this laptop, so no API
  data): both themes, the hero, the menu and the page end render.

**Next**: Devices & places page (B1c), Person 360 with daily activity (first / last activity,
active time), admin-only person pages + access log.

**Notes / known issues**
- `npm run test:smoke` not run (needs the Docker stack).
- Detail pages keep their old breadcrumb words ("Users", "Journeys"); they move with B1b.

## 2026-11-19 — First automatic deploy: api image build fixed, CI now builds both images

The runner was registered on the server and Phase A (`629a529`) was pushed: the first real run of
the `deploy` job. `ci` passed; the deploy failed in `docker compose up --build` and the old
containers kept serving (the build fails before any container is replaced).

**Done**
- **Cause:** Phase A made `scripts/build-docs.ts` read the SDK versions from
  `packages/{react,node,express}/package.json` (`sdkVersionOf`), but `apps/api/Dockerfile` copies
  only `packages/shared` and `packages/auth` into the build stage → `ENOENT
  /app/packages/react/package.json` in `npm run docs:build`. CI did not see it: it runs
  `docs:build` in a full checkout and never built the images.
- **Fix:** `apps/api/Dockerfile` build stage copies the three SDK `package.json` files (manifests
  only; the SDKs are not built or shipped in the image).
- **Guard:** `.github/workflows/deploy.yml` has a new job `images` (parallel to `ci`) that builds
  the api and web images; `deploy` needs both. DEPLOY.md §12 and 06-process.md say so.
- **Verified locally** (Docker 29.9): both images build; the api image against a throwaway
  `postgres:18-alpine` — `node dist/db/migrate.js` applies 0001–0012, the api boots,
  `/api/health/ready` = ok / `schemaCurrent: true`, `/api/docs/` serves the guide.

- **Second run (`bc6b48f`, the fix above): Phase A went live, but the run's health step failed
  falsely.** Images built, `migrate` exited 0 (0007–0012 applied), api and web healthy — then
  `scripts/deploy.sh` looped on `curl: (23) client returned ERROR on write of 96 bytes`.
  Cause: `ci-deploy.sh` exports `MSYS_NO_PATHCONV=1` (for docker args), so on the Windows server
  Git's native curl got the literal path `/dev/null` from `curl -o /dev/null` and could not open
  it, although the edge answered 200 (96 bytes = the `/api/health/ready` body). A deploy by hand
  never set that variable, and ADR 0005's sandbox test used a fake `deploy.sh`, so this path had
  never run. **Fix:** `deploy.sh` `probe()` sends the body to the shell's `/dev/null`
  (`curl … >/dev/null`, plus `--max-time 10`); reproduced and verified in Git Bash with
  `MSYS_NO_PATHCONV=1` against the live site (2xx passes, a 404 still fails).
- Production after that run: v2 is serving (`/api/health/ready` ok + `schemaCurrent`,
  `POST /v1/ingest/config` answers, the guide lists SDK 1.1.0). The automatic rollback could not
  replace it, because the previous commit `629a529` does not build (the Dockerfile bug above) —
  luck, not design: with a buildable previous commit the false health failure would have put the
  old version back. The server checkout may be left at `629a529` until the next deploy resets it.

**Next**: push the `deploy.sh` fix (the run should end green and leave the checkout on `main`);
then check the Integration page for all connected apps.

**Notes / known issues**
- `ci-deploy.sh` printed "no earlier commit to roll back to": the server clone was already at the
  pushed commit, so there was nothing older to rebuild. Harmless here (nothing had been replaced).
- The repo `Shahil0511/NEXUS-TRAFFIC` is **public** while a self-hosted runner on the production
  server serves it — a pull request from a fork can ask to run code on that runner. Make the repo
  private (or restrict fork pull-request workflows in Settings → Actions) — owner decision.
- **SDK tarball links 404 on production**: the guide links `files/sdk/nexus-*.tgz` (chapters 0
  and 8), but the api image never runs `sdk:pack` (it has no SDK sources), so
  `…/traffic/api/docs/files/sdk/nexus-react-1.0.0.tgz` answers 404 on the live site (checked
  2026-11-19; snippets under `files/snippets/` are served fine). Not caused by Phase A. Until it
  is fixed, teams get the tarballs from `npm run sdk:pack` in this repo. Fix = build and pack the
  SDKs in the api image (needs their sources + dev deps in the build stage) — not done yet.

---

## 2026-11-19 — Phase A: data quality (environment, linking, identity, remote config, PII, diagnostics)

Built by a multi-agent workflow in three waves (contract + DB first; then React SDK, node SDK +
snippets, API ingest, API read/admin and web in parallel, each followed by a reviewer-fixer; then a
cross-package checkpoint; then the EBO_SALES update and these docs; then a final multi-lens review
whose confirmed findings are fixed below). One commit for all of it.

**Done** (ADRs [0008](decisions/0008-environment-dimension.md) ·
[0009](decisions/0009-sdk-remote-config-and-kill-switch.md) · [0010](decisions/0010-ingest-pii-detector.md) ·
[0011](decisions/0011-header-propagation-and-early-entry.md) · [0012](decisions/0012-browser-retry-queue.md) ·
[0013](decisions/0013-integration-diagnostics-and-kpis.md))
- **A1 page grouping**: the React tracker sends `routeTemplate` (`nextRouteTemplate` from
  `useParams()`, `:name` / catch-all `:name*`; React Router via `matchRoutes()` in the Vite snippet);
  the API keeps it only when `isPlausibleRouteTemplate` holds, else `FIELD_DROPPED` + guess.
  **Page-id cut-over**: dynamic routes of an upgraded app get new `toPageId`s; no backfill.
- **A2 linking**: header propagation **on by default, same-origin** (`propagateHeadersTo` for exact
  other origins), XHR patch (axios), live per-call gating, SDK requests on a captured native fetch,
  early entry `@nexus/react/early` (`installNexusEarly`; Next `instrumentation-client.ts`, Vite
  first-import `nexus-early.ts`), one `SessionStore` in global state `@nexus/react/state@2`,
  pre-allocated page-view id. KPI: linkable = browser-device `http` calls; `AppTrafficDto.linkedPct`
  redefined on it.
- **A3 identity**: SSO cookie outcome per browser batch (`traffic.sso_cookie_outcomes`, typed
  `CookieFailureReason` + `no-email`, beacon origin vs `PUBLIC_ORIGIN`, none for replays);
  identified % per source on Integration Health and combined on Applications, both from
  `coverage-predicates.ts`; `getUser` "defaults to anonymous" warnings in snippets, READMEs and guide.
- **A4 environment**: `environment` on both envelopes (lenient wire, `resolveEnvironment`: loopback
  browser origin → `dev`, no server IP heuristic), stored on both event tables (default `prod`);
  dashboard `?env=` filter (absent = prod, `all`), `TrafficFilter.environments` required in every
  read; Live / online / snapshot prod only; Integration Health unfiltered (environment mix).
- **A5 hidden data**: `web_events.client_tz`, `client_lang`, `release` stored; `ROUTES.overview.breakdown`
  (browser / os / device / referrer host / nav / time reason / tz / lang / release / environment; share =
  of all window events) and `ROUTES.overview.devices` (new vs returning devices, 30-day bounded
  lookback); "Audience" section on the application page.
- **A6 retry queue**: in-page `fetch` + keepalive single-flight (`BatchSender`), `classifyDelivery`,
  persisted per key scope in localStorage (20 batches / 128 KiB / 24 h / 3 replays, own `RetryStorage`
  without memory fallback), `client.replay: true` (server skips the cookie), purge on kill,
  `getNexusStats()`.
- **A7 remote config + kill switch**: `POST /v1/ingest/config` (text/plain, no preflight, no-store,
  own rate limiter, no rejection recorder), `apps.sdk_config_*` columns, `PATCH /v1/apps/:slug/sdk-config`
  (optimistic `expectedVersion`, 409, audited `APP_SDK_CONFIG_UPDATE`), kill switch =
  `browser_ingest_enabled`, pre-auth early CORS (own `AllowedOriginCache` instance, rule
  `registered` = ANY app lists the origin, killed / disabled apps included; deduplicated in-flight
  lookups) so kill codes are readable cross-origin, IP failure limiter counts only
  `IP_FAILURE_ERROR_CODES` (key guesses + `ORIGIN_NOT_ALLOWED`, never a kill code). A lifted kill
  re-arms the tracker in the same page. Apps page remote config dialog (kill switch saved first).
- **A8 PII detector**: `PiiScrubber`, two passes (before ids; stored-path segment scrub after),
  `FIELD_REDACTED`, counts in `traffic.pii_detections` (inserted rows only), warning `pii_detected`.
- **A9 rejections**: `traffic.ingest_rejections` (code, strict `normalizeSdkLabel`, `normalizeSchemaPath`,
  ≤ 20 keys per batch, never messages); recorder only on `ingest.server` / `ingest.browser`.
- **A10 Integration Health**: identity / linking / release coverage, environment mix (source order =
  `INGEST_SOURCE_VALUES`), PII detections, rejection reasons, SSO outcomes, SDK name/version split,
  integration level (`not_connected` → `complete`), web panels + `CoverageValue`.
- **A11 index**: `idx_api_requests_page_view_id` (partial). BRIN rejected (ADR 0013).
- **Contract** (`packages/shared`): new constants (`ENVIRONMENT_*`, `SDK_CAPTURE_MODULE_VALUES`,
  `SDK_MODULE_SWITCH_MIN_VERSION` = 1.1.0, `SSO_COOKIE_OUTCOME_VALUES`, `BEACON_ORIGIN_VALUES`,
  `LINKABLE_DEVICE_CLASSES`, `BREAKDOWN_DIMENSION_VALUES`, `constants/pii.ts`, coverage targets,
  `AGGREGATE_RETENTION_DAYS`, `RETURNING_DEVICE_LOOKBACK_MS`), `FIELD_REDACTED`,
  `INGEST_REJECTION_CODE_VALUES`, `SDK_KILL_ERROR_CODES`, `KEY_GUESS_ERROR_CODES`,
  `IP_FAILURE_ERROR_CODES`, `SDK_DEFAULTS.browser.maxPendingBatches` / `ingestTimeoutMs`, leaf
  constants `SDK_BROWSER_SESSION_IDLE_MS` / `SDK_BROWSER_CONFIG_MAX_STALE_MS` / `SDK_BROWSER_XHR_PATCH`
  (for the early entry's size), schemas
  (`sdkConfigRequestSchema`, `sdkRemoteConfigSchema`, breakdown / devices queries,
  `updateSdkConfigBodySchema`), DTOs, 4 new ROUTES leaves; `docs/openapi.json` regenerated.
- **DB**: migrations `0007`–`0012` (environment + client context, page-view index, app SDK config +
  audit CHECK swap, 3 aggregate tables); the 3 tables in the explicit `grants.ts` DML list (the
  default privileges do not cover a fresh DB — README rule 8 corrected); parity, runner and
  privileges suites extended; aggregate retention after 90 days in the nightly retention run
  (`RetentionJob` → `AggregateRetentionService.deleteExpired` → repository).
- **SDKs 1.1.0** (`@nexus/react`, `@nexus/node`, `@nexus/express`): `environment` option (default
  `NEXUS_ENVIRONMENT`, sent only when valid), express `release` default `NEXUS_RELEASE`,
  `stats().rejectedByCode` (≤ 32 codes), strict RFC UUIDs in express, FastAPI
  `NexusClient(url, key, *, environment=None, …)`; new snippets `docs/snippets/next-instrumentation-client.ts`,
  `docs/snippets/vite-nexus-early.ts`; snippet contract tests for both.
- **Docs**: guide chapters 00–05, 07–11 and the appendix (environment, release, route templates,
  early install, propagation + CORS warning, retry queue, remote config / kill switch, readable
  cross-origin errors, PII detector, SSO cookie requirements + `getUser`, Integration page panels and
  level, troubleshooting rows); new `{{TOKENS}}` derived from shared constants and the SDK
  `package.json` versions in `scripts/build-docs.ts`; `docs/CHANGELOG.md` "v1 additive — 2026-11";
  ai-context 02, 03 (§3/§3b/§3c/§4/§4b/§5/§5d), 04, 07, 08, 09, GLOSSARY.
- **Final review fixes** (confirmed findings of the multi-lens review):
  - **Kill switch readable for a killed app's own origin**: the early CORS used the preflight rule
    (`is_active AND browser_ingest_enabled`), so the kill itself made the 403 unreadable
    cross-origin. New `AppRepository.anyListsOrigin` + a second `AllowedOriginCache` (rule
    `registered`) for the early CORS; e2e with a killed / disabled app on its own origin.
  - **`ORIGIN_NOT_ALLOWED` floods bounded again**: counted by the per-IP failure limiter
    (`IP_FAILURE_ERROR_CODES`, `isCountedIpFailure`); kill codes stay exempt (ADR 0009 item 10,
    with the NAT trade-off). e2e: a forged-Origin flood from one IP ends in `429`.
  - **PII**: `request_id` and `release` are scanned with the STRICT patterns
    (`PiiScrubber.scrubOpaqueId`) — random hex / UUID request ids no longer read as mobiles (≈ 1 %
    false `pii_detected`); phone patterns now match `98765 43210`, `+91-98765-43210` and a bare
    `91` prefix (`919876543210`), also as a path segment (ADR 0010).
  - **React SDK**: a lifted kill re-arms trackers in the same page (slow recheck timer while killed,
    `applyEnabledForScope`); the first `load` page view keeps the session the early headers used
    when the user hint is not known yet (`SessionStore.nextEvent(…, keepForUnknownUser)`); the
    header source is chosen per request (`headerSourceFor(url)` — the early `propagateHeadersTo`
    survives a tracker without one); relative URLs resolve against `document.baseURI`; a decorated
    `Request` keeps its referrer / referrer policy; the in-page sender queue is bounded
    (`maxPendingBatches`) and live ingest fetches time out (`ingestTimeoutMs`); unload persists a
    failed in-flight batch; the config timeout covers the body and a refresh always settles;
    other scopes' expired storage is pruned on start (`stale-scopes.ts`); `propagateHeadersTo` that
    is not an array never crashes the render.
  - **Early bundle**: `dist/early.js` 8,108 B / `early.cjs` 8,120 B (≤ 8 KiB): minified entry, no
    class-field helper, leaf constants; `npm run sdk:pack` now fails over budget (ADR 0011 item 7,
    pending the owner's OK on "shipped, minified" as the reading of the budget).
  - **Docs**: redirect + CORS caveat of default-on propagation (README, chapter 3, troubleshooting),
    README "patches stay for the page's lifetime with the early install", examples now
    `@nexus/react` / `@nexus/express` 1.1.0, ingest-auth header comment, 08 → chapter 10 §5.
  - **EBO_SALES**: the rebuilt `nexus-react-1.1.0.tgz` re-vendored and its lockfile integrity
    refreshed (`npm ci` and `tsc` pass); still uncommitted there.
- **Tests / gates after the final fixes** (throwaway `postgres:18-alpine` on :55432): `npm run
  typecheck` and `npm test` green in every workspace (api 1058, web 387, react 140, node 119,
  express 59, shared 65, auth 10); `RUN_DB_TESTS=1 npm run test:db` 106 files / 1311 tests;
  `openapi:emit -- --check`, `env:example -- --check`, `docs:build`, `sdk:pack` clean. (Wave 2
  checkpoint before them: api 1044, react 126, shared 63, DB 1295; an in-process run of the real
  `RemoteConfigClient` against the real API — config 200, module switch v2, kill 403 readable
  cross-origin — passed.)

**Notes / known issues**
- **Numeric props are not PII-scanned** (only string values): `{mobile: 9876543210}` is stored as is.
  Recorded in ADR 0010 as the current choice; the owner may decide to scan numbers too (follow-up ADR).
- PII false positives accepted: a 10-digit path segment starting 6–9 becomes `:phone` in the raw path;
  `logo@2x.png` looks like an email; a few word+number segments look like a PAN.
- Early-entry budget: the shipped `dist/early.js` / `.cjs` are ≤ 8 KiB because that entry is
  minified (unminified output would be ≈ 20 KB); `sdk:pack` enforces it. Reading the spec's
  "8 KiB unminified" this way is **pending the owner's OK** (ADR 0011 item 7).
- `ORIGIN_NOT_ALLOWED` counts per IP again: an app whose page origin is not registered, used by many
  people behind one office NAT, can `429` browser ingest from that IP until the origin is added.
- The SDK config client polls at most once per `maxAgeMs` per page whatever the outcome (polling
  floor); `keyScope` trims the key.
- Replayed browser events are stored anonymous (by design), so identity coverage reads slightly low
  for apps with many replays.
- `toRejectionIncrements` may exceed 20 keys by one fold key per code (bounded); a tracker that
  starts with a cached kill leaves earlier early patches as pass-throughs until a kill arrives in
  the page; the `latest_release` aggregation builds one array per SDK row (revisit if the health
  window grows).
- Many Phase A lines exceed prettier's width; there is no format gate (HEAD is not prettier-clean
  either) — a repo-wide prettier pass would be its own decision.
- `npm run docs:build` wipes `docs/dist` — rerun `npm run sdk:pack` afterwards to restore the tarballs.
- EBO_SALES (ADR 0003) has the 1.1.0 tarball, `instrumentation-client.ts`, `environment` and
  `release` in its own working tree, left **uncommitted** there as always (its ruff, mypy, pytest
  100, lint, tsc and build passed in P7; after the final SDK fixes the tarball was re-vendored,
  `npm ci` and `tsc` pass). Any later `packages/react` change needs the same re-vendor (the
  lockfile pins the tarball's sha512).

**Next**: owner decisions (numeric-prop PII scanning; the early-entry budget reading — shipped
minified ≤ 8 KiB vs "unminified"; who hosts a private npm registry — until then tarballs); tell the
integrated teams about 1.1.0 (`environment`, early install, `getUser` check, the redirect / CORS
note for downloads);
watch the Integration page levels after the first deploys; Phase B (advanced analytics) on clean data.

---

## 2026-10-14 — Who's online now (live active users per app and what they are doing)

**Done**
- **Contract**: `ROUTES.live.online` (GET `/v1/live/online`), `liveOnlineQuerySchema` {app?, userKey?},
  `OnlineNowDto` / `OnlineAppDto` / `OnlineUserDto` (`packages/shared/src/dto/live.ts`).
- **API**: `WebEventQueryRepository.listOnlineUsers` (one row per app × verified user over both tables in the last
  5 minutes: newest action — route/page TEMPLATE, never the raw path, no IP — current page, event count; `page_time`
  flushes counted but ranked last) and `countOnlineByApp` (verified users + anonymous sessions per app, same
  definition as "Active users now"); `LiveService.online`, `LiveController.online`. No migration.
- **Web**: "Who's online now" panel on Live (per-app chips that set the app filter, people with app, current page,
  last action, "active N s ago", session link; refreshes every 15 s), "Online now" column on Applications + "N online
  now" on the app page, "Online now · in <app> · on <page>" badge on a user's page; `metricInfo('onlineNow')`.
- Built by a workflow: API and web agents in parallel, each followed by a reviewer-fixer (fixed: totals vs list
  mismatch for page_time-only people, stale "updated N s ago" while switching apps, screen-reader text of the column).
- **Tests**: api unit + DB integration (window bounds, app/user narrowing, anonymous counting, two apps = two rows,
  limit), web (panel, chips, empty state, column, badge).

**Notes / known issues**
- A custom event shows as "Custom event": `OnlineUserDto.lastEvent` has no `name` yet.
- People list capped at `ONLINE_USERS_LIMIT` (100) — the panel says so when the per-app totals are larger.

---

## 2026-10-14 — UX Wave 3: polish (design tokens, explanations, copy, mobile, wayfinding) + error codes

Built by a multi-agent workflow: six builders with disjoint file ownership, each followed by a
reviewer-fixer, then integration and a cross-cutting review.

**Done**
- **Design tokens** (`apps/web/src/app/globals.css`): `text-2xs` (11 px minimum; every `text-[10/11px]`
  replaced), `--link` (AA in both themes; all inline link hovers use it), `--info` (1xx/3xx), `--method-*`
  (MethodBadge), darker light-mode success/warning/destructive and chart 4xx/5xx; `designTokens.test.ts`
  checks contrast in both themes; PageHeader h1 `text-2xl`.
- **Metric explanations**: `lib/metricCopy.ts` (one definition per metric), `components/ui/tooltip.tsx`,
  `components/InfoTip.tsx`, `KpiCard info`, `DataTable` column `hint`; used on Overview, Applications,
  API Routes, route/page/tool/user detail, Users and Errors. KpiCard links via the label + card overlay.
- **Copy**: `components/CopyButton.tsx` (`CopyButton`, `CopyableText`, clipboard fallback) on request ids,
  session ids, app slugs/keys/snippets (never the secret), Integration values; private-IP warning explains
  that Geography stays empty.
- **Responsive shell**: `components/MobileNav.tsx` sheet below md, compact range select below xl, search
  collapses to an icon, viewer email from lg; checked at 360 px with Playwright (no horizontal overflow).
- **Wayfinding & empty states**: `components/Breadcrumbs.tsx` on every detail page (route, app, session,
  user, page, tool; emails masked), `components/WidenRangeButton.tsx` in empty states and the user 404,
  Panel heading ids unique (`useId`), Geography "no location" notice + `?metric=`, Pages/Tools loaded-rows
  filter + capped-list note (`components/LoadedRowsFilter.tsx`).
- **Error codes (contract → SQL → UI)**: `ErrorSummaryDto.byErrorCode`, `errorCode` on both errors leaves,
  grouped query + bound filter in `ApiRequestQueryRepository`, "Error codes" panel + `?errorCode=` chip.
- **Review**: a cross-cutting review workflow (correctness, a11y/UX, conventions/PII; every finding
  verified by a second agent) confirmed 13 findings — all fixed: error-code scope no longer skews route error
  rates, breadcrumbs carry the entity's app, panel headers wrap on phones, empty states never dead-end
  (next wider preset or Integration link), unknown-app 404 is not "no activity", Geography wording by metric,
  focus kept after clearing filters, nav label contrast, neutral capped-list note.
- **Tests**: see the counts in the commit; `npm run typecheck && npm test` and `RUN_DB_TESTS=1 npm run test:db`
  (throwaway `postgres:18-alpine` on :55432) green.

**Next**: retention cohorts, funnels and per-page/tool totals (`total` on WindowedListDto for an exact
"of N"); a `--chart-info` token; axe checks in the Playwright smoke suite.

**Notes / known issues**
- Breadcrumbs are fixed trails per entity (`applicationCrumbs`), not `from=` links — this closes the Wave 2
  "breadcrumb from=" note.
- New shareable URL state: `?errorCode=` (Errors), `?metric=` (Geography).
- The Error codes panel shows the top 10 codes (`TOP_ERROR_CODES_LIMIT`); "no code sent" can fall outside it.
- The 360 px layout was checked with Playwright by the responsive builder; the browser used for the final
  walkthrough could not shrink its window.

---

## 2026-10-14 — UX Wave 2: users × apps × features drill-downs

**Done** ([ADR 0007](decisions/0007-page-and-tool-ids-and-drill-downs.md))
- **Contract**: `ROUTES.users.activity`, `ROUTES.pages.detail` (`/v1/pages/:app/:pageId`), `ROUTES.tools.detail`
  (`/v1/tools/:app/:toolId`); `USER_SORT_VALUES` + `sort`/`dir` on the Users list and search; `userKey` on both
  errors leaves; `UserUsageDto`; new fields on endpoint detail, error summary, user summary/profile, page stats,
  tool usage, app traffic (`identifiedPct`, `linkedPct`); `toPageId` / `toToolId` (node-only, UUID v5).
- **API**: `ApiRequestQueryRepository.listTopUsers` / `countUsers` / `listUserTopEndpoints` / `listPageApiCalls`;
  `WebEventQueryRepository` user sort whitelist, `listUserApps`, `listDailyUsers`, `pageStatsStatement` (+ distinct
  users), `getPageDetail`, `getToolDetail`, template/tool resolution lists; `fillCountGaps`. No migration.
- **Web**: page and tool detail pages (`PageDetailView`, `ToolDetailView`), `PageLink` / `ToolLink` everywhere a
  page/tool is listed; route page "Top callers" + Users KPI; user page "Apps used", "Top API routes",
  "View failures"; Users table sortable by every column + "Failed" (→ Errors `?userKey=`) + "First seen";
  Errors "Users affected" + "Most affected users" + user scope chip; Overview "Active users" (DAU chart, last
  7 / 30 days); Applications "Identified" / "Linked" coverage columns; `TopUsersList`, `CountChart`; latency
  chart draws isolated buckets as dots (was an empty chart for sparse ranges).
- **Tests**: api unit (new: page/tool detail, activity, profile routes/apps, user-scoped errors), DB 91 files
  (new: top callers, users affected + user scope, page/tool detail sums, user sort, per-app profile, DAU ≤ WAU ≤ MAU),
  web 31 files (new: page/tool detail, Users sort in URL, failed link, Errors user scope, profile routes/apps, DAU).
- **Deployed DB, read-only EXPLAIN ANALYZE** (2026-10-14): page → API calls ≈ 250 ms, DAU 30 d ≈ 100 ms,
  sorted Users 30 d ≈ 85 ms.

**Next (Wave 3)**: design tokens (11 px minimum, `--link`, method/status colours), metric explanations (tooltips),
copy buttons for ids, breadcrumbs (`from=`), mobile sidebar drawer, axe checks in the smoke suite; later:
retention cohorts, funnels, error grouping.

**Notes / known issues**
- DB tests now ran on a throwaway `postgres:18-alpine` on :55432 (`TEST_PG_ADMIN_URL` default). Do NOT point them at
  the dev container: the migrate bootstrap resets the cluster-wide `nexus_app` password (happened once in Wave 1,
  restored from `.env.dev`).

---

## 2026-10-14 — UX Wave 1: linked navigation, Ctrl+K search, Applications page, consistent numbers

**Done** ([ADR 0006](decisions/0006-navigation-search-and-applications.md); from a multi-agent UX audit)
- **Contract** (`packages/shared`): `ROUTES.overview.apps` (GET) + `AppTrafficDto`; `ROUTES.users.search`
  (POST, `userSearchBodySchema`) and `search` removed from `userListQuerySchema`; `errorSummaryQuerySchema.endpointId`;
  ids for links: `RequestSampleDto.sessionId`, `TimelineItemDto.endpointId`, `SessionEventDto.endpointId`,
  `LiveEventDto.userKey/endpointId/sessionId`.
- **API**: `OverviewService.apps` (`summarizeTrafficByApp` + `summarizeActivityByApp` + `AppRepository.list`,
  `mapAppTraffic`); `UserService.search`; identified users over both tables (`countIdentifiedUsers`);
  users' `sessions` = browser sessions; `ErrorService.summary` scoped by `endpointId`. No migration.
- **Web**: Applications list + app page (`features/applications/`); `CommandPalette` (Ctrl/⌘+K, "/");
  `AppChip`, `UserLink`, route links in failed/slowest rows, timelines, replays and Live; KPI cards link to
  their breakdown (`KpiCard.href`); Overview "Applications" panel; per-page filters + range cap
  (`NavItem.filters`, disabled presets, `RANGE_TOO_LARGE` → "Show the last 30 days"); named filter chips
  (route on Errors, user on Journeys); `keepPreviousData` on list hooks + top fetching bar; `RelativeTime`;
  tab titles on detail pages (masked email); "View traffic" on Integration cards.
- **Tests**: api 720+ unit, DB/e2e 91 files green (`RUN_DB_TESTS=1`, new: `overview.apps` equals the scoped
  Overview, route-scoped error summary); web 29 files (new: Applications, CommandPalette, RangePicker,
  nav filters, POST search never in the URL).

**Read-only check of the deployed database (2026-10-14, `default_transaction_read_only=on`)**
- 7 apps registered; 6 send server events, nexus-portal browser only. Migrations 0001–0006 applied, partitions to 2026-12.
- `overview.apps` / `countIdentifiedUsers` over 30 days: ~35 ms / ~16 ms (≈28 k rows) — no index needed yet.
- **Location is empty everywhere**: 100 % of events have a private/loopback IP (api 7 568 private, 189 loopback,
  1 public; web 16 811 private) → no geo. Either every user is on the office LAN/VPN or a proxy hides the
  client IP (check `X-Forwarded-For` on the gateway). Geography is useless until then.
- **Identity gaps**: ebo-kpiverse and finance-recon send 100 % anonymous API calls and no session ids;
  ebo-kpiverse browser ingest accepted 0 (1 rejected); nexus-portal ~38 % of page views without a verified user.
- **Linking gaps** (API call ↔ page view): stockapp 64 %, ebo-sales 29 % of calls without `session_id`.
- **Unparameterised page templates**: stockapp `/virtual-stock/product/<id>` (one template per product).
- **Slow / failing routes in the apps (for their teams)**: ebo-kpiverse `/api/style-kpis` p95 ≈ 131 s;
  ebo-sales `/filters/options` p95 ≈ 31 s with 21 × 500; stockapp `/virtual-stock/search` ≈ 30 s (timeouts, 500/499);
  ebo-leaderboard `/insights`, `/leaderboards/summary` ≈ 15 s with `QUERY_TIMEOUT` 503s.
- 13 of 38 users in 30 days use more than one app (the Applications/Users cross-links matter).

**Next (Wave 2)**: who-calls-this-route / user's top routes + per-app split; sortable Users with "Failed" and
"New"; page and tool detail pages; Errors "users affected"; DAU/WAU/MAU; identity / linking coverage per app on
Applications; a subnet → office mapping for private IPs (or hide Geography when 100 % private).

**Notes / known issues**
- `npm test` needs `npm run build -w @nexus/node` first (the express package imports its dist), as CI does.
- `RUN_DB_TESTS=1` defaults to a test Postgres on :55432 (start a throwaway `postgres:18-alpine` there; not the dev container, see Wave 2 notes).
- Breadcrumb `from=` links and a mobile sidebar drawer are not done yet (Wave 3).

---

## 2026-10-08 — CI/CD: push to `main` deploys to the server (like EBO_SALES)

**Done** ([ADR 0005](decisions/0005-ci-cd-self-hosted-runner.md))
- `.github/workflows/deploy.yml`: `ci` on ubuntu-latest for every push/PR (`npm ci`, typecheck, `npm test`,
  `npm run test:db` on a `postgres:18-alpine` service, `env:example --check`, `openapi:emit --check`,
  `docs:build`) → `deploy` on `[self-hosted, nexus-traffic-prod]` for pushes to `main` only, serialized.
- `scripts/ci-deploy.sh <sha>`: fetches the commit with the job token (no git login on the server),
  `git reset --hard`, re-execs its new version, runs `SKIP_PULL=1 scripts/deploy.sh`; on failure resets to the
  previously deployed commit and deploys it again, exit 1. Windows servers run it through Git Bash.
- `scripts/setup-runner.ps1` / `scripts/setup-runner.sh`: one-time runner install (own folder
  `C:\actions-runner-nexus-traffic` / `/opt/actions-runner-nexus-traffic`, side by side with EBO_SALES' runner;
  only replaces its own service), records `DEPLOY_DIR`; refuses a checkout without `.git`.
- DEPLOY.md section 12 (setup + moving from the handoff zip to a git clone), 06-process.md (files, Git rule:
  a push to `main` = a production deploy).
- Verified: PowerShell parser (0 errors, ASCII-only), `bash -n`; `ci-deploy.sh` in a sandbox repo with a fake
  `deploy.sh` (good deploy, failing deploy → rollback to previous commit, `.env` untouched, path with a space,
  token + `safe.directory` env path); every `ci` step in a fresh clone (typecheck, build, `npm test` 713 + 151 + …,
  `test:db` 882/882 on `postgres:18-alpine`, generated-file checks).
- Fixes found by the fresh clone: `ci` builds `@nexus/shared`, `@nexus/auth`, `@nexus/node` before the tests (package
  and web tests import their `dist/`); `apps/api/test/ai-context-links.test.ts` skips git-ignored local env files
  (`apps/api/.env`, `apps/web/.env.local` exist only on a dev machine).

**Next**: the user registers the runner on the server (token from NEXUS-TRAFFIC → Settings → Actions → Runners)
and pushes; the first real run proves the GitHub side.

**Notes / known issues**
- Not run against GitHub yet (the runner needs the user's token).
- `apps/api/test/e2e/live-socket.test.ts` timed out once (10 s) in a full parallel run on Windows, then passed; watch it in CI.
- EBO_SALES' `setup-runner.ps1` deletes every `actions.runner.*` service when re-run; on a shared Windows server,
  re-run ours after it.

---

## 2026-10-05 — One-port hosting (edge nginx) + handoff zip for the Team Lead

**Done** ([ADR 0004](decisions/0004-one-host-port-edge-nginx.md)) — the user hosts Nexus like EBO_SALES: a zip to
the TL, who runs compose and assigns ONE port.
- `docker-compose.yml`: `edge` (nginx) always on and the only published port
  `${NEXUS_BIND_ADDRESS:-0.0.0.0}:${NEXUS_PORT:-8080}`, with a healthcheck; api and web no longer publish
  4005/3305. The former local-only gateway copy is now `ops/nginx/edge.conf` (passes the gateway's
  `X-Forwarded-Proto`, relative redirects);
  `ops/nginx/nexus-traffic.conf` now forwards `/traffic/…` to one upstream with the path kept.
- `.env.example` (generator): new section *Hosting* (`NEXUS_PORT`, `NEXUS_BIND_ADDRESS`, compose-only keys),
  `TRUST_PROXY_HOPS=2` (gateway + edge; schema default stays 1 for `npm run dev`).
- `scripts/deploy.sh` works from an unpacked zip (no `.git` → no pull) and checks health through the edge;
  `scripts/preflight.sh` checks `NEXUS_PORT` instead of 4005/3305.
- New `scripts/handoff/make-handoff-zip.ps1` (git-visible files + `.env.production` as `.env`, refuses
  `change-me` and localdb values) and the TL's one-page `HANDOFF.md` (repo root, EBO style); `DEPLOY.md` and
  ai-context (02, 03, 06, 09, ADR 0001 note) updated. Local rehearsal is now `docker compose --profile localdb up`.

---

## 2026-10-05 — Dashboard auto-refresh + EBO_SALES request linking (audit of the integration)

**Done** (the user reported: location unknown, features unclear, pages only update after a tab switch)
- **Audit against the dev DB:** EBO sent 131 server + 45 browser events (`page_view`, `page_time`,
  `tool_use`), email on 129/131. Two real problems found, one non-problem:
  1. **No request ↔ page-view linking** (`session_id`/`page_view_id` null on every server event):
     `openapi-fetch`'s `createClient()` captures `globalThis.fetch` at module load, before the tracker
     wraps it. Fixed in EBO (`frontend/src/lib/api/client.ts`: late-bound fetch); the gateway → Next proxy
     → FastAPI path was verified to carry both headers into `traffic.api_requests`. Guide chapter 9
     (`docs/integration/09-environments.md`) now warns about clients that capture `fetch`.
  2. **Analytics pages never refreshed** (60 s staleTime, no focus refetch, no socket) → new
     `apps/web/src/features/live/useAutoRefresh.ts` + `autoRefreshPolicy.ts` + `AutoRefresh.tsx`
     (see [02-architecture.md](02-architecture.md) § Real-time); 12 new tests.
  3. **Location unknown = localhost**, not a bug: dev traffic is loopback (no geo). A public IP sent
     through EBO's 2-hop chain resolved to IN / MH / Mumbai.
- Live socket through the dev dashboard (`localhost:3000/traffic/socket.io`) measured: websocket
  transport, event visible 4.6 s after the request (the 5 s SDK flush dominates).

**Notes / known issues**
- Only tools that were actually clicked appear on the Tools page (4 of ~30 ids so far) — expected.
- In local dev, browser events carry the Nexus dashboard's own dev cookie (`admin@libas.in`), because
  `localhost` cookies are shared across ports; production has one portal cookie.

---

## 2026-10-05 — EBO_SALES integrated (reference integration) + FastAPI snippet fixes

**Done**
- **Decision:** [ADR 0003](decisions/0003-ebo-sales-reference-integration.md) — the user allowed edits in
  `D:\server\EBO_SALES` (their own app); every other `D:\server` app stays read-only. CLAUDE.md,
  [README.md](README.md) and [01-project-overview.md](01-project-overview.md) note the exception.
- **Snippet fixes** in `docs/snippets/fastapi_nexus_asgi.py` (found by integrating EBO_SALES):
  1. route templates lost outer router prefixes on FastAPI 0.13x+ (`scope["route"]` holds the
     router-relative path, e.g. `/filters/options` for `GET /api/v1/filters/options`) → new
     `_restore_router_prefix` rebuilds the prefix from the real path + `path_params`; older FastAPI unchanged;
  2. `mypy --strict` errors ("None not callable") → `get_user` / `get_error_code` bound to locals before
     the lambdas. No contract change (no CHANGELOG entry).
- **EBO_SALES** (uncommitted, in its own repo — files listed in its docs/NEXUS_TRAFFIC.md): vendored snippet
  + `@nexus/react` tarball (from `npm run sdk:pack`), backend switch `NEXUS_ENABLED` and frontend switch
  `NEXT_PUBLIC_NEXUS_ENABLED` (both default ON only in production), `<NexusTracker propagateHeaders>` in its
  providers, ~30 `TOOL.*` ids on the main UI actions, Dockerfile/compose build args, 15 new backend tests.
- **Local Nexus:** app `ebo-sales-dev` registered in the dev DB (no base path, origins localhost:3000–3002);
  its keys sit in EBO's git-ignored `backend/.env` / `frontend/.env.local` with both switches `false`.
- **Verified end to end** against the local api: 3 server events accepted, `identity_source=app_attested`,
  public IP from the 2-hop XFF chain, `/health` skipped, full template `/api/v1/filters/options`;
  `NEXUS_ENABLED=false` sends nothing; publishable key passes `GET /v1/ingest/verify`.

**Next**
- Production cut-over (user, later): register `ebo-sales` on https://nexus.libas.in/traffic/, put the prod
  keys + URL into EBO's server env, `docker compose up -d --build` — steps in EBO's docs/NEXUS_TRAFFIC.md.
- Browser events from EBO_SALES not yet exercised in a real browser (SDK covered by its own tests; EBO
  side typechecks, lints and builds with the key inlined).

**Notes / known issues**
- EBO_SALES's own warehouse config on this laptop (`DB_NAME`) fails with *database "libas_read" does not
  exist* — unrelated to Nexus (same 500 with monitoring off).
- Recipes chapter 8 still says the React hook is "coming" although `@nexus/react` shipped in S5.

---

## 2026-10-03 — S6 Jobs, backups/restore, DEPLOY.md, security suite, Playwright smoke, doc-link test

**Done**
- **Jobs** (chain [03-code-navigation.md](03-code-navigation.md) §5d): `apps/api/src/jobs/scheduler.ts` now waits
  for runs in flight on `stop()` (explicit list, no overlap, unref'd timers); `apps/api/src/lifecycle/shutdown.ts`
  awaits it before ending the pools (injectable `exit`, failsafe cleared). Partition maintenance and retention
  already ran on the advisory-locked client (S1 carry-over fix confirmed). New tests: `scheduler.test.ts`,
  `shutdown.test.ts`, `apps/api/test/db/retention-job.integration.test.ts` (real container, `RAW_RETENTION_MONTHS=1`,
  back-dated partitions, as `nexus_app` via the SECURITY DEFINER function: only expired months dropped, once
  per IST day). No new migration (`drop_expired_partitions` exists in 0001).
- **Backups**: `BACKUP_AT_IST` / `BACKUP_KEEP` (compose-only keys, `.env.example` regenerated, passed to
  `pg-backup`, validated in `ops/backup/run.sh`). New `ops/backup/restore.sh` (rename schema → restore in one
  transaction → drop old / rename back on failure; plain `pg_restore --clean` fails on partitions). Rehearsed on
  the local stack: manual dump, pruning, invalid-time rejection, scratch-DB restore and in-place restore → migrate
  no-op, `/api/health/ready` 200.
- **DEPLOY.md** (repo root) for the TL: prerequisites, owner-mode `.env` for 10.150.0.5 / `nexus_traffic`
  (URL-encoding), preflight, gateway snippet (+ commented `auth_request off;` in `ops/nginx/nexus-traffic.conf`),
  deploy, health checks (incl. websocket 101), first app + keys, curl.sh smoke, hairpin check, update/rollback,
  jobs, backups/restore, open questions. `scripts/deploy.sh` always waits for the web health check.
- **Security suite** `apps/api/test/security/`: `security.test.ts` (no DB; header table maps every plan case to
  the test proving it): CSRF + admin + cookie on every non-GET `apps.*` leaf, forged leftmost XFF cannot dodge the
  per-IP failure limiter, `javascript:`/non-absolute paths rejected by the contract, expired / forged /
  disallowed socket tokens refused at the handshake. `security.integration.test.ts`: revoked key rejected on the
  next request (cache invalidated), forged XFF → stored IP is the gateway hop, same `session_id` in two apps never
  mixes (incl. a correlated API call), `javascript:` path rejected over HTTP and by the DB CHECK as `nexus_app`.
  Existing tests referenced for Origin null/foreign, secret key on browser, poison bisect, 23514 retry, IP masking.
- **Playwright smoke** `apps/web/e2e/` (`npm run test:smoke`, not in `npm test`): auth redirect, Overview, API
  Routes → endpoint detail, Live row within seconds of an ingest (socket via `edge`), Apps as admin.
  Ran against the rebuilt local stack: 5/5 passed.
- **ai-context doc-link test** `apps/api/test/ai-context-links.test.ts` (markdown links + repo-path code spans in
  ai-context, DEPLOY/CLAUDE/AGENTS; exempts the other-teams table of 08). Fixed the 2 broken references it found.
- **Polish**: `apiErrorBodySchema` exported from `packages/shared/src/schemas/errors.ts` (used by
  `scripts/emit-openapi.ts`; openapi unchanged); `scripts/tsconfig.json` + `npm run typecheck:scripts` (part of
  `npm run typecheck`); dead `demo:traffic` script removed; DB tests for `activityTimeseries` /
  `listRecentEvents`; docs: 06-process (tests, gates, git, deploy/rollback), 04-how-to-recipes, 03 §5d.
- **Gates**: `npm run typecheck` clean; `npm test` green (api 713 + 169 DB-skipped, web 136, shared 32, node 83,
  express 43, react 37, auth 10); `RUN_DB_TESTS=1 npm run test:db` 882/882 on PostgreSQL 18 and on 17;
  `env:example --check`, `openapi:emit --check`, `docs:build` OK.

**Next**: push `main` after the user approves; then the TL dry-runs [`DEPLOY.md`](../DEPLOY.md) on the server
and answers its open questions.

**Notes / known issues**
- Non-admins still see "Admins only" on Apps (plan: read-only list for everyone) — deliberate, not changed.
- Live snapshot past ticks carry `activeUsers: 0`; Pages/Tools/Geography have no totals endpoint (unchanged).
- Column lengths without `INGEST_LIMITS` constants and TEST-NET IPs classed `public` (S1 notes) unchanged.
- `scripts/dev` vitest tests are not part of the root `npm test`.
- The smoke registers an app `smoke-test` and writes a few events into the LOCAL database it runs against.

---

## 2026-10-03 — Local dev the EBO_SALES way (no sign-in in dev)

**Done** (requested by the user: "local dashboard and backend in dev like EBO_SALES, no auth check")
- `npm run dev` = `build:shared` + `concurrently` (`[api]` tsx watch :4000, `[web]` next dev **:3000**);
  `npm run dev:api` / `dev:web`; one-time `npm run dev:setup` ([`scripts/dev/setup.ts`](../scripts/dev/setup.ts):
  `.env.dev` → dev DB :55434 → builds → migrations → writes `apps/api/.env` + `apps/web/.env.local`).
  The older all-in-one launcher is now `npm run dev:launcher`.
- **No sign-in in dev:** `DEV_USER_EMAIL` (web env, optional) — `proxy.ts` `devSignInToken` signs an
  `access_token` with the dev secret only under `next dev` (`NODE_ENV=development`); production unchanged.
  Signer moved to `@nexus/auth` `signAccessToken` (reused by `scripts/dev/token.ts`).
- The api / migrate CLI load `apps/api/.env` BEFORE the root `.env`; `.dockerignore` now excludes
  `**/.env` and `**/.env.*`. Dev dashboard moved from 3305 to 3000, so it no longer collides with the
  docker rehearsal's web container.
- Tests: 3 proxy dev sign-in cases; web 139, api 713, dev scripts 41 green; typecheck clean.
  Checked live: `http://localhost:3000/traffic/` → 200 without a login, `/api/v1/me` → admin.

---

## 2026-10-03 — S5 Integration Health, Apps admin UI, snippet contract tests, guide

**Done**
- **Contract**: `packages/shared/src/constants/integration.ts` (status + warning codes, thresholds: 24 h window,
  stale after 24 h, private-IP warning > 90 % with ≥ 20 events, clock skew > 60 s); `dto/integration.ts`
  extended. `PENDING_ROUTE_LEAVES` is now **empty** — every ROUTES leaf is served.
- **API** (chain [03-code-navigation.md](03-code-navigation.md) §4b): `IngestHealthRepository.perApp`
  (5 read-only queries), `domain/integration-health.ts` (pure rules), `IntegrationService`,
  `IntegrationController`, route open to any dashboard user.
- **Web**: Integration page (tiles + per-app card: status, warnings linked to guide chapters via
  `lib/guide.ts`, counters per source, SDK/skew table, private-IP share). Apps admin page (admin only; register/
  edit with the shared schemas, keys table with "exposed" badge, one-time key reveal that closes only via "I have
  stored the key", expire with grace / revoke in in-page dialogs). New `ui/{dialog,switch,textarea}`,
  `AdminOnly`, `FormField`, `InlineError`.
- **Integration kit**: `packages/node/src/snippets-payload.contract.test.ts` (23 tests: snippets validated
  against the shared schemas), `apps/api/test/docs-build.test.ts` (no `{{…}}` left, absolute links). Guide:
  rotation steps (01), Integration page in verify (10), a troubleshooting section per warning (11).
- **Tests**: `npm run typecheck && npm test` green (api 675); `RUN_DB_TESTS=1 npm run test:db` 834/834.

**Next (S6)**: retention + partition jobs (`apps/api/src/jobs/`), backups check, nginx + `DEPLOY.md` for the TL,
security suite (plan Phase 2 list), Playwright smoke via `edge`, ai-context doc-link test, polish, push `main`.

**Notes / known issues**
- Non-admins see an "Admins only" panel on Apps (the plan had the app list visible to all).
- `npm run sdk:pack` must run after `npm run docs:build` (docs:build clears `docs/dist`).

---

## 2026-10-01 — S4 Socket.io live + Live page

**Done**
- **Contract** (`packages/shared/src/events.ts`): `SOCKET_PATH`, `LIVE_SESSION_SWEEP_MS`, session-end reasons,
  `LIVE_AUTH_ERROR_MESSAGE`, `liveRoomOfScope()` / `parseLiveRoom()`; `live.snapshot` no longer pending.
- **API**: `src/socket.ts` `createRealtime` (missing Origin allowed, `null`/foreign rejected; `/` namespace
  refuses; `/live` checks the SSO cookie); `src/live/` (live-window, broadcaster with viewer payloads stripped
  of IP, feed, origin policy, socket auth, subscription handler, session sweeper, tick scheduler 2 s / flush
  1 s / sweep 60 s); `LiveService.snapshot` + `LiveController` (`no-store`); `server.ts` starts realtime after
  `listen`, `shutdown.ts` closes it first. Chain: [03-code-navigation.md](03-code-navigation.md) §5c.
- **Web**: `lib/socket.ts`, `features/live/` (`liveBuffer`, `useLiveSnapshot`, `useLiveFeed`,
  `endLiveSession`, `LiveView` — 4 tiles, 60-min chart, streaming table with pause/resume); proxy matcher skips
  `socket.io/`; dev-only rewrite of `/traffic/socket.io/` to the api.
- **Tests**: unit tests for every live module; `apps/api/test/e2e/live-socket.test.ts` (in-process server +
  `socket.io-client`: handshake rules, tick ≤ `LIVE_TICK_MS` after a row reaches `LiveFeed`, role masking);
  `LiveView` with a fake socket. `apps/api/vitest.config.ts` now resolves `@nexus/source` (tests ran on dist).

**Notes / known issues**
- The SQL of `WebEventQueryRepository.activityTimeseries` / `listRecentEvents` has no DB test yet.
- The snapshot uses `timeseries(filter, 'minute')` instead of the plan's `lastHourBuckets`; past ticks carry
  `activeUsers: 0`.
- Overview has no live sparkline (it does not expect one); no Playwright smoke yet (S6).

---

## 2026-10-01 — S3 Browser ingest + Users / Journeys / Pages & Tools / Geography

**Done**
- **Browser ingest** (`POST /api/v1/ingest/browser`, chain in [03-code-navigation.md](03-code-navigation.md) §3b):
  OPTIONS preflight (`AppRepository.anyAllowsOrigin`), `beaconBody` (text/plain or JSON, 60 KiB),
  `parseBeaconJson`, envelope validation, `publishableKeyAuth` (key in the body; secret key → 403
  `SECRET_KEY_EXPOSED` + `exposed_at`; `APP_DISABLED`; `BROWSER_INGEST_DISABLED`), `browserIngestCors`,
  `originGuard`, per-key (`INGEST_RATE_LIMIT_BROWSER_PER_MIN`, new, 6000) and per-session rate limits.
  `BrowserEventEnricher`, `toWebEventInsert`, base-path rule (`PATH_OUTSIDE_APP`), `WebEventIngestRepository`;
  dedupe / partition retry / bisect shared with the server path via `IngestService.storeBatch`.
- **Read side** (§5b): `WebEventQueryRepository` (users, profile, timeline, sessions, session replay, top
  3-step paths, page stats, tool usage + trend, countries, cities; IP admin-only), `User/Journey/Page/Tool/
  GeoService` + controllers; `session-replay.ts`; shared `WindowedListDto` and DTO additions.
- **Web**: Users + profile, Journeys + session replay, Pages / Tools (one nav entry, two routes),
  Geography (bar chart, "approximate" cities, GeoLite2 attribution). New components `ActivityEvent`,
  `RankedList`, `RankedBarChart`, `Sparkline`.
- **Docs**: guide lists the per-app browser rate limit.
- **Tests**: api 607 unit + S3 DB blocks (`analytics-queries` 31/31, `e2e/dashboard` 17/17), web 105.

**Notes / known issues**
- Pages, Tools and Geography have no totals endpoint; they show top-N lists only.

---

## 2026-10-01 — S2 Dashboard shell + SSO + Overview / API Routes / Errors

**Done**
- **Contract**: dashboard leaves for overview / endpoints / errors in `packages/shared/src/routes.ts`;
  `PENDING_ROUTE_LEAVES` now lists only the S3–S5 leaves (shared by the api route contract test and the
  web client coverage test); `time-window.ts` extended for bucket alignment.
- **API read side**: `ApiRequestQueryRepository` (+ `WebEventQueryRepository` stub for S3), services
  `OverviewService`, `EndpointService`, `ErrorService`, `query-window.ts`; domain helpers
  `compute-deltas`, `pagination` (keyset cursors), `timeseries-gaps`, `filters`, `numbers`; mappers/rows;
  controllers + `cache-control.ts`. Chain documented in [03-code-navigation.md](03-code-navigation.md) §5.
- **Web** (`apps/web`, Next.js): SSO proxy (`proxy.ts`), app shell + nav, global filters (app, range),
  Overview (KPIs, traffic/latency/error charts), API Routes list + endpoint detail, Errors (summary, top
  failing endpoints, failed requests with "Load more"); later pages render `ComingSoon`.
- **Local dev**: `npm run dev` launcher (`scripts/dev/`: dev Postgres container on :55434, migrate, seed,
  sample traffic, dev token, launcher page), `scripts/mint-dev-token.ts`. See
  [09-local-development.md](09-local-development.md).
- **Docker**: `web` service in compose, nginx routes `/traffic` → web and `/traffic/api` → api.
- **Tests**: api 502 unit + DB suites (`analytics-queries`, `e2e/dashboard`), web 81, dev scripts 41,
  shared 31 — green.

**Next (S3)**: browser ingest (`POST /api/v1/ingest/browser`, public key, `exposed_at` on secret-key use),
`web_events` query repository, Users / Journeys / Pages & Tools / Geography pages; remove the S3 leaves
from `PENDING_ROUTE_LEAVES`.

---

## 2026-10-01 — Production database created (ADR 0002)

- Database `nexus_traffic` created on the shared server 10.150.0.5 (PostgreSQL 18.1, owner `shahil`).
  No other database (Unicorn, agreementvault, app_chatbot) was modified.
- `migrate` run in `DB_APP_ROLE_MODE=owner`: 0001–0006 applied, 8 monthly partitions
  (2026-09 … 2026-12) for `api_requests` and `web_events`. No role was created on the cluster.
- Schema `traffic` contains: apps, api_keys, admin_audit_log, api_requests (partitioned),
  web_events (partitioned), ingest_counters, schema_migrations. No test data was written.
- The TL's `.env` must use `DB_APP_ROLE_MODE=owner` and identical `DATABASE_URL` /
  `MIGRATION_DATABASE_URL` pointing at `10.150.0.5:5432/nexus_traffic` (password URL-encoded).

---

## 2026-10-01 — ADR 0002 (external database) + S1 carry-over fixes

**Done**
- **Role modes** (`DB_APP_ROLE_MODE = separate | owner`, default `separate`): `apps/api/src/db/migrate-config.ts`
  (`NEXUS_APP_DB_PASSWORD` required ≥ 16 chars ONLY in `separate`, one-line error naming the key; `appRoleOf()`),
  `apps/api/src/db/migration-runner/bootstrap.ts` (`bootstrapDatabase(pool, appRole)`; `owner` = schema + ledger
  only, never touches a role; password safety unchanged). Production on 10.150.0.5 / `nexus_traffic` runs `owner`
  (`DATABASE_URL` = `MIGRATION_DATABASE_URL`); localdb, CI and the DB suites run `separate`.
- **Grants moved out of migrations:** `0007_grants.sql` deleted; the same statements live in
  `apps/api/src/db/migration-runner/grants.ts`, applied by the runner after the migrations (apply mode,
  `separate` only, one transaction under the migrate advisory lock, before the partitions). Idempotent: a
  revoked grant is repaired on the next run. Runner option `appPassword` → `appRole`.
- **Compose:** `postgres` only with profile `localdb`; `postgres:18-alpine` via the `x-pg-image` anchor
  (`PG_IMAGE` overridable); volume at `/var/lib/postgresql` (PG18 image layout, verified in the image:
  `PGDATA=/var/lib/postgresql/18/docker`, `VOLUME /var/lib/postgresql`); `migrate` / `pg-backup` use
  `depends_on … required: false`; `DB_APP_ROLE_MODE` passed to migrate; `NEXUS_APP_DB_PASSWORD` optional.
  `pg-backup` dumps `BACKUP_DATABASE_URL` (default `MIGRATION_DATABASE_URL`) with `pg_dump … -Fc`
  (`ops/backup/run.sh`, restore = `pg_restore -d "$BACKUP_DATABASE_URL"`).
- **Env + preflight:** `.env.example` regenerated (database section with both modes, URL-encoding note,
  placeholders only; `POSTGRES_*` marked localdb-only; `BACKUP_DATABASE_URL`); `scripts/preflight.sh`
  gained `--localdb`, mode-aware required keys, hex check only for the three HMAC secrets (+ the app password
  in `separate`), owner-mode URL identity, raw-`@` detection, and a TCP check of the DB host:port (skipped for
  the `postgres` service).
- **S1 fixes:** error handler delegates to `next(err)` once headers were sent; `serverIngestJsonBody` reads the
  media type from the `Content-Type` header, so an empty JSON body reaches the envelope validation, which now
  answers `400 INVALID_ENVELOPE` (as the guide documented; `docs/CHANGELOG.md`); `PartitionService.ensureAhead/
  dropExpired(exec?)` and both jobs run their work on the advisory-locked client; `RetentionJob` takes
  `ADVISORY_LOCKS.retention` (write pool injected in `container.ts`) and retries on the next tick after a failure.
  Documentation IP ranges stay `public` (comment in `ip.anonymizer.ts`).
- **Docs:** ADR 0001 "Postgres / roles" row points to ADR 0002; 02-architecture (container table + mermaid),
  03-code-navigation, 06-process (two ways to run), 07-data-model (roles), GLOSSARY, `apps/api/migrations/README.md`.
- **Tests:** api 534 with `RUN_DB_TESTS=1` on **PostgreSQL 18.6** and on **17** (440 unit + 94 DB/e2e; shared 28, auth 10), new:
  owner-mode suite (restricted login without CREATEROLE: bootstrap + migrations create/alter no role, no grants,
  api runs as the owner), grants re-applied idempotently, status/dry never touch grants, migrate-config modes,
  job/advisory-lock tests with a fake pool, empty-body tests (incl. a raw request without Content-Length).
- **Rehearsal (fully local, PG18):** old PG17 volume removed (`down -v`), `.env` regenerated for localdb
  (separate mode, fresh hex secrets), `docker compose --profile localdb --profile local up -d --build` → migrate
  exit 0 (6 migrations, grants, 8 partitions), `/api/health/ready` 200 on :4005 and `/traffic/api/health` 200 on
  :8080, manual `pg-backup --once` OK, `docs/snippets/curl.sh` with a fresh key: verify 200, dry run 202, send
  `accepted:1`, resend `duplicates:1`; then `down` (volume kept).

**Next:** the TL runs `migrate` against 10.150.0.5 / `nexus_traffic` in `owner` mode (first production deploy),
then S2.

**Notes / known issues**
- The comments of migrations `apps/api/migrations/0001_helpers_and_partitions.sql` / `0003_admin_audit_log.sql` still mention `0007_grants.sql`; left as is (editing an applied file
  is checksum drift). A database migrated by an S1 rehearsal lists `0007_grants` as unknown-applied (warning).
- `deploy.sh` runs `--remove-orphans` and the production preflight (no `--localdb`); it is meant for the
  external-database deploy only.

---

## 2026-10-01 — S1 Database, server ingest, key admin, docs skeleton, Docker

**Done**
- **Database** (`apps/api/migrations/`, files 0001–0007, see `apps/api/migrations/README.md` and
  [07-data-model.md](07-data-model.md)): helpers + monthly partition functions, apps/api_keys, append-only
  admin audit log, `api_requests`, `web_events` (schema only), `ingest_counters` (IST hour buckets),
  grants for `nexus_app` (DML only). Migration runner + CLI (`apps/api/src/db/migrate.ts`, exit codes
  ok 0 / failed 1 / drift 2), bootstrap of `nexus_app`, schema guard (api refuses to start if behind).
- **Server ingest** (`POST /api/v1/ingest/server`, `GET /api/v1/ingest/verify`): key parse/hash/cache/
  authenticate, per-IP failure and per-key rate limits, enrichment (path, route template, IP + geo, UA,
  identity, user key, time window), `toApiRequestInsert`, idempotent batch insert, partition retry,
  poison-row bisect, dry run, counters. Chain: [03-code-navigation.md](03-code-navigation.md) §3.
- **App/key admin API** (`/api/v1/apps…`, SSO + `X-Nexus-Dashboard` + admin): list, create, update, create/
  expire/revoke key; one transaction + audit row per change; key cache invalidated after commit.
- **Docs**: public guide `docs/integration/` → `docs/dist` (`npm run docs:build`), OpenAPI
  (`npm run openapi:emit`), snippets in `docs/snippets/`, served by `DocsController` at `/api/docs/`.
- **Docker**: `apps/api/Dockerfile`, `docker-compose.yml` (postgres → migrate → api, edge with
  `--profile local`, pg-backup), `ops/nginx/`, `scripts/preflight.sh`, `scripts/deploy.sh`, generated `.env.example`.
- **Integration**: scaffolding marker removed; contract tests `apps/api/test/routes-contract.test.ts`
  (+ `EXPECTED_PENDING` for S2–S5 leaves) and `apps/api/test/no-scaffolding.test.ts`; in-process e2e
  `apps/api/test/e2e/ingest.integration.test.ts` (real container + app, admin routes → ingest over HTTP).
- **Tests**: api 407 unit (41 files) + 89 DB/e2e (6 files, `RUN_DB_TESTS=1`), shared 28, auth 10 — all green.
- **Rehearsal**: `docker compose --profile local up -d --build` → all healthy, migrate exit 0 (7 migrations,
  8 partitions); `/api/health`, `/api/health/ready`, `/traffic/api/health` 200; `/traffic/api/docs` 308 →
  `/traffic/api/docs/` 200; `docs/snippets/curl.sh` via edge: verify 200, dry run 202, send `accepted:1`,
  resend `duplicates:1`.

**Next (S2)**: `apps/web` shell + SSO + Overview / API Routes / Errors; query repositories on
`api_requests`; fill the dashboard section of [03-code-navigation.md](03-code-navigation.md); remove the
S2 leaves from `EXPECTED_PENDING`.

**Notes / known issues**
- **ADR 0002 (external database on 10.150.0.5, `DB_APP_ROLE_MODE=owner|separate`, compose `localdb`
  profile, Postgres 18 images) is NOT implemented yet.** S1 still ships the original design: compose
  `postgres:17-alpine` service and a mandatory `nexus_app` role created by the migrate bootstrap.
  Production deploy needs that ADR implemented first (env schema, bootstrap, compose, backups).
- DB column lengths with no `INGEST_LIMITS` constant (ua_*, geo_region/city, sdk, …) are fixed in the
  migrations only (the UA parser clamps browser/os to 128 via `UA_FACET_MAX_LENGTH`). Suggested contract
  change: add them to `INGEST_LIMITS` so the parity test checks them.
- `clock_skew_ms` is `bigint` and `geo_country` is `text` + CHECK (departures from the plan, see 07-data-model).
- `PartitionMaintenanceJob` takes the advisory lock on a client but `PartitionService.ensureAhead` runs on
  the pool (harmless: the SQL functions are race-safe). Fix in S6 with the jobs work.
- `error-handler.middleware.ts` returns early (instead of `next(err)`) when headers were already sent;
  `serverIngestJsonBody` answers 415 rather than 400 for an empty body with `Content-Type: application/json`.
- 203.0.113.0/24 (TEST-NET, used by the examples) is classed `public` by `classifyIp` and has no geo.
- The OpenAPI error envelope is a script-local zod schema; an exported `apiErrorBodySchema` in shared would
  remove the copy. No `scripts/tsconfig.json` yet (scripts are type-checked only ad hoc).
- `ai-context/08-integration-contract.md` lists other teams' file paths; the planned ai-context
  doc-link test (not written yet) must exempt that table.

---

## 2026-10-01 — S0 Foundation

**Done**
- Monorepo (npm workspaces `packages/*`, `apps/*`), `tsconfig.base.json` with `customConditions: ["@nexus/source"]`
  (ctrl-click into shared opens `src/`), prettier, git (`main`), `.gitattributes` (LF everywhere).
- `@nexus/shared`: `routes.ts` (ROUTES, buildPath), `events.ts` (socket contract), `errors.ts`,
  `constants/*` (enums mirrored by DB CHECKs, key format, ingest limits, time/range rules),
  `ingest/*` (contract v1 zod schemas, examples, `resolveClientIp`, `buildIngestUrl`),
  `schemas/*` (dashboard query/admin schemas), `dto/*`, `time-window.ts`, `endpoint-id.ts` (node-only).
- `@nexus/auth`: `verifyAccessToken` (HS256, pinned alg, exp/nbf/type), `extractEmail`, `readCookie`,
  `verifyAccessTokenCookie`, `decideDashboardAccess`.
- Tests: 28 shared + 10 auth, all green; both packages build to CJS `dist/`.
- ai-context: README, overview, architecture, conventions, glossary, ADR 0001, this log.

**Next (S1)**: migrations + migration runner, API skeleton (config, container, errors, logger), server ingest,
app/key admin endpoints, Dockerfile + compose (postgres, migrate, api), docs page skeleton.

**Notes / known issues**
- `package-lock.json` was first generated on Windows; regenerate it inside `node:22-alpine` before the
  first Docker build (Linux musl optional binaries).
- `toEndpointId` lives in `@nexus/shared/endpoint-id` (node-only, not in the root barrel).
