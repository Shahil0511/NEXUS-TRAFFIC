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
