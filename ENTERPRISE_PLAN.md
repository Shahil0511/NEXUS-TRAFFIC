# Nexus Traffic — Enterprise Hardening Plan

> **For Claude Code.** Place this file at `ai-context/plans/ENTERPRISE_PLAN.md`.
> Read `CLAUDE.md` and `ai-context/README.md` first. Every rule there still applies
> (contract-first via `packages/shared`, conventions in `05-conventions.md`, ADRs for decisions,
> a `PROGRESS.md` entry per step, PII rules).

## 0. Context — read before doing anything

This is **not** a greenfield or "rookie" codebase. It already has: a contract-first monorepo,
6 versioned SQL migrations with a custom runner, partitioning + retention jobs, ~1,300 unit/integration
tests, a security test suite, Playwright smoke tests, ADRs, an OpenAPI spec, reference SDKs, backups
with a tested restore script, and graceful shutdown.

**So the goal is not a rewrite.** The goal is to add the *operational and governance layer* that
separates "well-built project" from "enterprise system": automated gates, release discipline,
observability, least privilege, secrets handling, compliance features, and documented reliability
targets. Do not restructure working code unless an item below explicitly calls for it.

### Working rules for this plan

1. Work **one phase at a time, one item at a time**. Start each item in plan mode; show the plan;
   wait for approval before editing.
2. One item = one branch = one PR-sized commit. Branch name: `hardening/<item-id>-<slug>`.
3. Each item must end green on: `npm run typecheck && npm test` (+ `RUN_DB_TESTS=1 npm run test:db`
   if the DB is touched), plus any new gate the item introduces.
4. Any architectural choice (Redis or not, secrets backend, registry, RBAC model) → **new ADR first**.
5. Never touch `D:\server` except `D:\server\EBO_SALES` (ADR 0003).
6. If an item turns out to be already done, say so with evidence (file + test) and skip it.

---

## Phase 0 — Hygiene and least privilege (do first, small, urgent)

**P0.1 Secrets exposure review.** The working folder contains live production secrets in
`.env`, `.env.production`, `.env.production.bak`, `.env.localdb.bak`, `apps/api/.env`,
`apps/web/.env.local`, and real data in `backups/*.dump`. Git is clean (`.gitignore` is correct),
but the folder has been zipped and shared.
- Delete the `.bak` env files. Add a `scripts/check-secrets-on-disk.sh` that warns if `.bak`/dump files exist.
- Write `docs/ops/SECRET_ROTATION.md`: how to rotate `DATABASE_URL` password and `API_KEY_PEPPER`
  safely, and **why `USER_KEY_SECRET` / `IP_HASH_SECRET` cannot be rotated without a re-hash
  migration** (HANDOFF says they must never change). `LIBAS_JWT_SECRET` belongs to the portal team —
  document coordination, do not change it unilaterally.
- Acceptance: doc exists; rotation of the DB password and pepper rehearsed on the localdb profile.

**P0.2 Production least privilege.** Production runs `DB_APP_ROLE_MODE=owner` (the api uses the
schema owner login). Draft the exact SQL request for the DBA to create a DML-only role so prod
can run `separate` mode like local/CI. ADR documenting the current exception and the target.
- Acceptance: `docs/ops/DBA_REQUEST.md` with ready-to-run SQL; ADR 0005.

**P0.3 Git discipline.** Add `CONTRIBUTING.md` (branching, Conventional Commits, PR checklist),
`.github/pull_request_template.md`, `.github/CODEOWNERS`, commitlint + husky (or lefthook) with
pre-commit `prettier --check` + gitleaks. Recommend (document, don't do) branch protection on `main`
and confirm the GitHub repo is private.

---

## Phase 1 — Static quality gates and CI

**P1.1 ESLint.** There is no linter today (only Prettier + tsc). Add flat config at the root:
`typescript-eslint` (strict-type-checked), `eslint-plugin-import` (no cycles, no default exports —
matches conventions), `eslint-plugin-security`, `react-hooks`, `jsx-a11y`, `@next/eslint-plugin-next`
for `apps/web`, `eslint-plugin-vitest` for tests. Fix violations in small batches; where a rule is
noisy, disable it with a written reason in the config, not inline.
- Acceptance: `npm run lint` at root, zero errors, added to the gate list in `CLAUDE.md`.

**P1.2 GitHub Actions CI** (`.github/workflows/ci.yml`), on PR and push to `main`:
install (cache) → lint → typecheck → unit tests → DB tests against a `postgres:18` service container →
`env:example --check` → `openapi:emit --check` → `docs:build` → build both Docker images →
Playwright smoke against the localdb compose profile (can be a separate job, required on `main`).
- Coverage via vitest `--coverage`; set thresholds at current level minus 2% so it only ratchets up.
- Include `scripts/dev` tests in CI (PROGRESS notes they are outside root `npm test`).

**P1.3 Supply-chain security.**
- `npm audit --audit-level=high` (or osv-scanner) in CI.
- CodeQL workflow for JS/TS.
- Trivy scan of both built images; fail on HIGH/CRITICAL with a fix available.
- Dependabot (or Renovate) for npm, Docker base images, and GitHub Actions; weekly, grouped.
- Generate an SBOM (CycloneDX) per release.

---

## Phase 2 — Release and deployment discipline

**P2.1 Immutable images.** Today the server runs `docker compose up --build` from a zip. Change to:
CI builds and pushes `nexus-traffic-api` and `nexus-traffic-web` to a registry (GHCR or Libas
internal — ADR) tagged with git SHA and semver. `docker-compose.yml` references
`${NEXUS_IMAGE_TAG}`; the server only pulls. Keep `--build` as a documented fallback.

**P2.2 Versioning and releases.** Semver for the app; `release.yml` workflow on tag `v*`:
build, scan, push, attach SBOM, generate release notes from Conventional Commits + `docs/CHANGELOG.md`.
SDK packages (`@nexus/node`, `express`, `react`) versioned independently (changesets).

**P2.3 Safe migrations.** Add to `05-conventions.md`: expand/contract rule (no destructive change in
the same release that stops using a column), and a CI check that new migration files are append-only
(existing files' checksums unchanged — the ledger likely already records checksums; reuse it).

**P2.4 Rollback runbook.** `DEPLOY.md`: rollback = set previous `NEXUS_IMAGE_TAG` + `up -d`;
state when a DB restore is needed instead. Add a staging environment definition (same compose,
separate DB) and a promotion step.

---

## Phase 3 — Observability

**P3.1 Metrics.** Add `prom-client` and a `/traffic/api/metrics` endpoint (not exposed through the
public gateway — edge-internal or token-protected). Metrics, each with a test:
- HTTP RED: request count, error count, duration histogram per route template.
- Ingest: events accepted / rejected by reason / rate-limited, batch size, enrichment duration.
- DB: pool total/idle/waiting for both pools, query duration by repository method.
- Jobs: last success timestamp + duration for partition maintenance, retention, live sweeper.
- Socket.io: connected clients, broadcast lag.
- Backups: `run.sh` writes a last-success marker the api (or node-exporter textfile) can expose.

**P3.2 Error tracking.** Sentry or self-hosted GlitchTip (ADR) for api and web, with the existing
redaction (`lib/redact.ts`) applied in `beforeSend`. Release = image tag.

**P3.3 Logs.** Logs are already JSON lines with request id. Document shipping them (Loki/ELK —
whatever Libas runs) and add the request id to the web → api calls and to error responses.

**P3.4 SLOs and alerts.** Write `docs/ops/SLO.md`: e.g. ingest availability 99.9%, ingest p95 < 200 ms,
dashboard p95 < 1.5 s, live lag < 10 s, backup age < 26 h, RPO 24 h, RTO 2 h (confirm numbers with
the user). Alert rules file (Prometheus/Grafana) for each SLO + "job hasn't succeeded in N hours".
Each alert links to a runbook section in `docs/ops/RUNBOOKS.md`.

**P3.5 Health.** Confirm `/health/ready` checks DB with a timeout and reports degraded state when
jobs are stale; add compose healthcheck timeouts/start periods where missing.

---

## Phase 4 — Reliability, performance, scale

**P4.1 Decide the scaling model (ADR first).** The api is deliberately single-instance:
in-memory rate limits, in-memory API-key cache, Socket.io without an adapter. Either
(a) record "single instance by design" with the limits it implies, or
(b) add Redis: `rate-limit-redis` store, key-cache invalidation via pub/sub, `@socket.io/redis-adapter`.
Jobs are already advisory-locked, so they are multi-instance safe. Do not implement (b) without approval.

**P4.2 Load testing.** Add `perf/` with k6 scripts: server ingest, browser ingest (beacon),
dashboard queries over 1 / 7 / 30 / 90-day windows, 200 concurrent live sockets. Record a baseline
in `docs/ops/CAPACITY.md` (events/sec, p95, DB CPU) and the point where it breaks.

**P4.3 Query performance.** For every dashboard repository query, capture `EXPLAIN (ANALYZE, BUFFERS)`
against seeded realistic volume (e.g. 50M events). Add missing indexes via migration. If long ranges
are slow, add hourly/daily rollup tables maintained by a job (ADR), and route long windows to them.

**P4.4 Container limits.** CPU/memory limits and `NODE_OPTIONS=--max-old-space-size` for api/web;
`ulimits` for edge; log rotation options on all services.

**P4.5 Backups.** Today dumps stay on the same host. Add: encryption (age/gpg), off-host copy
(object storage or another server — ADR), a monthly automated restore drill into a scratch DB that
reports success as a metric.

---

## Phase 5 — Security and compliance

**P5.1 Threat model.** `docs/security/THREAT_MODEL.md` (STRIDE over: ingest keys, browser beacon,
SSO cookie, socket, admin API, DB, backups). Map each threat to the existing test in
`apps/api/test/security/` or to a new item.

**P5.2 OWASP ASVS L2 checklist.** `docs/security/ASVS.md` — each requirement: status, evidence
(file/test), gap. Add `SECURITY.md` (reporting process, supported versions).

**P5.3 DPDP Act 2023 readiness.** The system stores personal data about Libas employees and
users (hashed user keys, emails on some events, IPs/geo, journeys). Add:
- A data inventory: field, purpose, lawful basis, retention, where hashed/masked.
- **Data principal requests:** admin API + UI to export and to erase all events for a user
  (by email → user key hash), audit-logged in `admin_audit_log`, with a DB integration test. Erasure
  must also cover backups' retention window (document, since dumps can't be edited).
- Retention settings surfaced in the UI and the integration guide.
- Notice text template that integrating apps show their users.
Flag clearly anything that needs a legal/privacy decision rather than inventing policy.

**P5.4 Key management.** API key expiry dates, rotation reminders on the Integration Health page,
"last used" already exists — add alerting for keys unused 90 days.

---

## Phase 6 — Access control and governance

**P6.1 RBAC.** Admins are an env var list (`DASHBOARD_ADMIN_EMAILS`). Move roles into the DB:
`admin`, `app_owner` (per app: manage keys, see IPs for that app), `viewer`. Contract first in
`packages/shared`, migration, policy class replacing `dashboard-access.policy.ts`, UI to manage
roles, every change audit-logged. Env list remains as bootstrap super-admins only.

**P6.2 Audit log UI.** Read-only, filterable view of `admin_audit_log` for admins, with CSV export.

**P6.3 Known issue.** Non-admins see "Admins only" on Apps — make it a read-only list (planned in PROGRESS).

---

## Phase 7 — Product polish

- Fix stale docs (recipes chapter 8 says the React hook is "coming").
- Live snapshot past ticks `activeUsers: 0`; totals endpoints for Pages/Tools/Geography.
- Accessibility: `@axe-core/playwright` in the smoke suite; keyboard navigation for tables/dialogs.
- CSV export on every table; shareable URLs for filter state (verify existing `useGlobalFilters`).
- Consistent empty / loading / error states audit across all views.
- In-product alerts (optional, needs ADR): threshold on error rate per app → email/Teams webhook.

---

## Phase 8 — Documentation for an operations team

- C4 diagrams (context, container) in `ai-context/02-architecture.md`.
- `docs/ops/RUNBOOKS.md` — one section per alert: symptom, check, fix, escalate.
- On-call/ownership page: who owns the app, the DB server, the gateway, the portal JWT.
- Onboarding guide for a new developer: clone → `npm run dev:setup` → first PR, in under an hour.

---

## Definition of "enterprise-ready" for this project

All of these true:
CI blocks merges on lint, types, tests, DB tests, audit, image scan · images are immutable and
tagged · rollback is one variable change · prod DB login is DML-only · secrets are not in zips ·
metrics, error tracking and alerts exist with runbooks · SLOs and capacity are measured, not guessed ·
backups are encrypted, off-host and restore-tested monthly · RBAC is in the DB and audited ·
DPDP export/erasure works · threat model and ASVS checklist are current.
