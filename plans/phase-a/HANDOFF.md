# Phase A — handoff (updated 2026-11-19, ~15:00 IST)

**Phase A is code-complete and all gates are green. Nothing is committed.** All changes are in the
working tree of `D:\server\NEXUS TRAFFIC` (294 status entries: 211 modified files + new files).
EBO_SALES (`D:\server\EBO_SALES`) has its own uncommitted changes (1.1.0 tarball,
`instrumentation-client.ts`, `environment`, `release`) and stays uncommitted there (ADR 0003).

The only thing left is the **owner's OK for the single commit** (and the push — a push to `main`
deploys to the server).

## What Phase A is

"Data theek karna": fix data quality before any advanced analytics. Approved items A1–A11:

| # | Item |
|---|---|
| A1 | Correct page grouping (SDK sends `routeTemplate`) |
| A2 | Browser ↔ server linking (XHR patch, `@nexus/react/early` entry, linking KPI) |
| A3 | Identity coverage (SSO-cookie outcomes, `getUser` guidance, % verified KPI) |
| A4 | `environment` (prod/staging/dev) on both envelopes; dashboards default to prod |
| A5 | Show stored-but-hidden data (browser/OS/device, new vs returning devices, release, tz/lang) |
| A6 | Persistent retry queue in the browser SDK |
| A7 | SDK remote config + kill switch (admin edits on the Apps page) |
| A8 | Ingest-time PII leak detector (PAN, GSTIN, Aadhaar, phone, email) |
| A9 | Rejected-event reasons stored (aggregated, no payloads) |
| A10 | Integration Health: coverage KPIs, SDK matrix, release status, env mix, integration level |
| A11 | DB indexes (`page_view_id` on `api_requests`) |

## Files in this folder

- `SPEC.md` — the final implementation spec. Source of truth for what was built.
- `RESEARCH-catalog.md` — the full research catalog (13 modules, 142 features, 32 decisions).
  Published page: https://claude.ai/artifact/JTKo2p4bF8Af87pp8wKq7Q
- `agent-reports/wave1-2-journal.jsonl` — raw reports of the wave 1–2 agents.

## Status

| Step | Status |
|---|---|
| P1 contract-db | ✅ implemented + reviewed |
| P2 react-sdk | ✅ implemented + reviewed |
| P3 node-sdk-snippets | ✅ implemented + reviewed |
| P4 api-ingest | ✅ implemented + reviewed |
| P5 api-read-admin | ✅ implemented + reviewed |
| P6 web | ✅ implemented + reviewed |
| Wave 2 checkpoint | ✅ |
| P7 ebo-sales | ✅ (uncommitted in EBO_SALES) |
| P8 docs / ai-context / ADRs 0008–0013 / PROGRESS | ✅ |
| Final review (4 lenses, 21 confirmed findings) | ✅ all 21 fixed |
| Final gates | ✅ re-run by hand on 2026-11-19 afternoon (see below) |
| Commit | ⛔ waiting for the owner's OK |

History: workflow `wf_75b7ffd0-bfc` (2026-11-19 morning) did everything up to the final fixes; its
last agent (`final:fix-and-gates`) was cut off at 13:45 IST during its last docs/tarball re-check,
after it had applied the fixes and run the gates. The gates were then re-run by hand in a new session:

- `npm run build:shared && npm run build -w @nexus/node && npm run typecheck` — pass
- `npm test` — pass in every workspace
- `RUN_DB_TESTS=1 npm run test:db` on a throwaway `postgres:18-alpine` (:55432) — 106 files, 1311 tests pass
- `npm run openapi:emit -- --check`, `npm run env:example -- --check` — current
- `npm run docs:build`, then `npm run sdk:pack` — pass; `dist/early.js` is 8,108 B (budget 8 KiB)
- EBO_SALES `frontend/vendor/nexus-react-1.1.0.tgz` has the same sha256 as `docs/dist/files/sdk/nexus-react-1.1.0.tgz`

The throwaway container is stopped. EBO_SALES backend/frontend checks were last run by the workflow
agents (P7 and the final agent), not in the hand re-run.

## Next steps

1. Ask the owner, then make the single commit in this repo (do not commit `EBO_SALES`).
   Any later `packages/react` change needs the EBO_SALES tarball re-vendored (lockfile pins its sha512).
2. Push only when the owner says so (push to `main` = deploy; migrations 0007–0012 run on the server DB).
3. Tell the integrated teams about SDK 1.1.0 (see PROGRESS "Next").

## Open questions for the owner

- Early-entry bundle: the shipped file is 8 KB because it is minified (unminified ≈ 20 KB). OK to
  read the "8 KiB" budget as "the shipped file"? (ADR 0011 item 7 is marked pending.)
- Numeric props are not PII-scanned (`{mobile: 9876543210}` is stored as is). Scan numbers too?
- Private npm registry for the SDK: who hosts it (Team Lead)? Until then: tarballs.
