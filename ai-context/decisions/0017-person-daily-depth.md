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
       time is screen time of a front tab and not input, two visible tabs both count, server-only apps add
       no time, only verified activity is shown and a shared login mixes people, first / last activity are
       recorded events and not sign-in or sign-out times, raw data is kept about 6 months.
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
- **Consequences:**
  - A new person-level label must pass `personCopy.test.tsx`; a new person-level screen must be added to it.
  - A new DTO field cannot carry a grading or ordering name; the shared test fails on it.
  - The one-day Visits link opens a list read that writes a `person_visits` access-log row, like "View visits".
  - Still to come, each recorded here when it ships: a read-side credit cap on long
    `page_time` deltas (it lowers some shipped tab-visible numbers), the one-day view and its access-log
    surface, making the visit steps of a verified person admin-only (this changes the ADR 0015 line that kept
    `journeys.session` open to every viewer), and usual activity hours.
