# ADR 0018 — The People list sorts by its count columns again

- **Status:** accepted (2026-11-25). Supersedes point 10 of [ADR 0017](0017-person-daily-depth.md) and its
  consequence line "a new sort key of the People list must be a time key". The rest of ADR 0017 is unchanged.
- **Context:** step B10-7 (ADR 0017 point 10, commit `5268f73`) took the count sorts (`requests`,
  `pageViews`, `sessions`, `failed`) out of `USER_SORT_VALUES`, the repository whitelist and the People
  table, so people could only be sorted by first or last activity. That was the default choice for an open
  question, and the spec said the owner could veto it. The owner did: the People list must again be
  sortable by its count columns.
- **Decision:**
  1. **Count sorts are back, end to end.** `USER_SORT_VALUES` (`packages/shared/src/schemas/analytics.ts`)
     is `lastSeen`, `firstSeen`, `requests`, `pageViews`, `sessions`, `failed`. `USER_ORDER_SQL`
     (`apps/api/src/repositories/web-event-query.repository.ts`) maps each key to its ORDER BY over the
     grouped `activity u` (the same count expressions the list selects). It stays a whitelist map: the
     sort value only picks an entry and never reaches the SQL as text, and `u.user_key ASC` stays the
     tie-breaker so paging is stable.
  2. **The People table** (`apps/web/src/features/users/UsersView.tsx`) has a sort control on API calls,
     Failed, Page views and Visits again, in both directions, the same control as First / Last activity.
     `?sort=requests` (and the other count keys) in the URL is kept, not replaced with the default.
  3. **The "Who uses it" panel of one app** (`ApplicationDetailView`) orders people by API calls again;
     its description states that order ("Verified people, most API calls first"), and its "All users of this
     app" link opens the People list with `?sort=requests`, so the full list keeps the panel's order.
  4. **Kept from B10-7:** `DEFAULT_USER_SORT` (`lastSeen`, most recently active first); the `.catch` on
     the list query and search body `sort`, so an unknown value falls back to the default instead of a
     400 (`dir` stays strict); the nuqs URL parser does the same; the headers First activity / Last
     activity with their hints (`METRIC_COPY.firstActivityInRange` / `lastActivityInRange`); the command
     palette's person search uses the default.
  5. **Wording stays neutral.** A sortable column is a sort, not a ranking: no rendered text, aria-label
     or title names the order as a rank, leaderboard or score (`NEUTRAL_COPY_BANNED`,
     `apps/web/src/lib/neutralCopy.ts`; the UsersView and ApplicationsView tests scan their copy).
- **Consequences:**
  - A new People sort key needs an entry in `USER_ORDER_SQL` (the `satisfies Record<UserSort, string>`
    fails the typecheck otherwise) and a row in the repository test.
  - Removing a sort key again leaves old links working (they fall back to the default), but needs a new ADR.
  - The DB integration suite covers a count sort (`pageViews`, both directions) and first activity.
