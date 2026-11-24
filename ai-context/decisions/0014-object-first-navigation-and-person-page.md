# ADR 0014 — Object-first navigation, page hero + page end, the Today preset, Devices & places and the person page

- **Status:** accepted (2026-11-23); implemented in Phase B steps 1–5 (see [PROGRESS.md](../PROGRESS.md)).
  Extends [ADR 0006](0006-navigation-search-and-applications.md) (linked navigation); the access rules
  for the person page are [ADR 0015](0015-admin-only-person-pages-and-access-log.md).
- **Superseded in part by [ADR 0016](0016-english-only-ui-icons-and-illustrations.md):** the `questionHi` (Hinglish) sentence of decision 2 is gone; screens are English only.
- **Extended by [ADR 0017](0017-person-daily-depth.md):** the Daily activity tab (decision 5) and the neutral labels (decision 6) go further there; "Active time (tab visible)" is now "Tab visible time", the identity card says First / Last activity, and the label rule is enforced by tests.
- **Context:** the sidebar listed pages by data source (API Routes, Journeys, Geography…), so a reader
  had to know how the data is collected to find an answer. Pages had no stated purpose and no visible
  end (it was unclear whether more was still loading). The shortest range preset that matched a
  calendar day was "24h", which straddles two IST days. Device, browser and place facts were spread over
  the Applications audience section and the Geography page, and the user detail page was one long column
  (KPIs, lists, timeline) with no per-day view.
- **Decision:**
  1. **Navigation is grouped by object, not by data source** (`NAV_SECTIONS` in `apps/web/src/lib/nav.ts`):
     a top group (Overview, Live), People (People, Visits, Devices & places), Apps (Apps, Pages & features,
     Request types, Problems) and Setup (Data health, App keys, Privacy & access). Item ids and URLs stay
     stable; renamed labels keep their old names searchable through `NavItem.description` (command palette).
     An item may cover more than one page (`alsoActiveOn`: Pages & Tools, Devices & places + `/geography`).
  2. **Every page opens with a hero and closes with a page end.** `NavItem.question` / `questionHi` hold the
     page's purpose in one English and one Hinglish sentence; `components/PageHeader.tsx` prints them on a
     list page (detail pages print their own description). `components/PageEnd.tsx`, rendered once by
     `components/AppShell.tsx` under every page, closes it with a labelled divider, the colour legend, an IST
     note and "Back to top". It says "End of <page>" only when that is true: `components/PageEndProvider.tsx`
     counts lists that can still "Load more" (`components/LoadMoreButton.tsx` registers through
     `useOpenListMarker`) and first loads in flight, and the footer says so instead.
  3. **`today` is a range preset** (`RANGE_VALUES` in `packages/shared/src/constants/time.ts`): the current IST
     calendar day, 00:00 up to the next 00:00 (`resolveTimeWindow` + `startOfReportingDay` in
     `packages/shared/src/time-window.ts`). The window ends in the future so a chart shows the whole day, but
     `elapsedTo` (now, clamped into the window) drives the comparison window (today 00:00–10:00 against
     yesterday 00:00–10:00) and gap filling (`apps/api/src/domain/timeseries-gaps.ts` stops at the current
     bucket), so KPI deltas compare like with like and hours still to come are not drawn as zeros.
  4. **Devices & places is one page** (`PAGES.devices()`, `apps/web/src/features/devices/DevicesView.tsx`) on the
     existing aggregate reads (`overview.breakdown`, `overview.devices`, `geo.countries`, `geo.cities`), with
     no contract change. Two tabs in the URL (`?tab=devices|places`); a "Show share of" switch
     (`?share=pageViews|requests`) picks the browser or the server source, and a dimension the chosen source
     lacks is greyed out without sending a request. Shares are drawn by `components/ProportionBar.tsx`: every
     label carries its unit, a bar's width is its share of the whole total, and an "All other values" bar
     makes the bars add up to 100 %. `/geography` keeps working and shares its content
     (`features/geography/GeoPlacesSection.tsx`). Totals only: nothing on this page is per person.
  5. **The person page (Person 360) uses the GLOBAL range, Today included** — there is no separate period
     parameter. `apps/web/src/features/users/UserDetailView.tsx` = an identity card that stays on screen on
     every tab (`PersonIdentityCard.tsx`: email with copy, Online now, apps, first / last seen in
     the range, latest known device facts from `users.profile`) and tabs in the URL (`?tab=summary|daily|devices|activity`,
     `userDetailParams.ts`): Summary, Daily activity, Devices, Activity. Daily activity is one row per IST day
     (`ROUTES.users.daily`; the service widens the window to whole IST days with `wholeReportingDays`):
     first activity, last activity (today's marked "so far", `inProgress`), a 00:00–24:00 strip, active time
     (tab visible) = Σ `page_time.visible_ms`, page views, requests, failed and visits. Devices are grouped by
     User-Agent facts (`ROUTES.users.devices`). Each tab sends its read only while it is open (Radix tabs unmount
     inactive panels, `components/ui/tabs.tsx`).
  6. **Neutral labels, no comparisons.** On-screen words are descriptive ("Daily activity", "First activity",
     "Last activity", "Active time (tab visible)", "Devices", "Visits"). No page computes a per-person score,
     rank or comparison between people.
- **Consequences:**
  - New pages need a nav item with `question` + `questionHi` (or print their own description) and get the
    page end for free; a paged list must use `LoadMoreButton` so the footer stays honest.
  - Any window that may still be running must read `elapsedTo` for comparisons and gap filling, not `to`.
  - Detail pages still use some older breadcrumb words ("Users", "Journeys"); aligning them is open.
  - Devices & places loads all its bars together (at most five queries on the Devices tab), not the first
    few first.
