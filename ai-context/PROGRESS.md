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
