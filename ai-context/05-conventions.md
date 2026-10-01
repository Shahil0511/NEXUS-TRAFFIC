# 05 — Conventions

These rules exist so that (a) every function does one job and (b) you can **ctrl-click** in VS Code
from a button on the dashboard all the way to the SQL that answers it, and back.

## 1. Navigation rules

1. **`ROUTES` is the only link across HTTP.** `packages/shared/src/routes.ts` defines every API path.
   The web client and the Express router both import it — never type a path string.
   Find All References (Shift+F12) on `ROUTES.endpoints.list` shows the caller and the handler.
2. **Same name at every layer.** `ROUTES.endpoints.list` → `controllers.endpoints.list` →
   `EndpointService.list`. The repository method is named in the route table and linked from the
   service with an `@see` comment.
3. **Shared code opens as source.** `tsconfig.base.json` sets `customConditions: ["@nexus/source"]`,
   so F12 on anything from `@nexus/shared` / `@nexus/auth` opens `packages/*/src`, not `dist`.
4. **Concrete classes as dependencies** (no `IThing` interfaces) so F12 lands on the real code.
   Exceptions: genuine ports with several implementations (`Clock`, the SDK `Transport`).
5. **Controller methods are arrow properties**, registered directly — no `.bind`, no `asyncHandler`
   (Express 5 forwards async errors itself).
6. **One composition root**: `apps/api/src/container.ts` builds everything. Jobs are listed
   explicitly in `jobs/scheduler.ts`.
7. **`@see` breadcrumbs**: service → repository → `../../migrations/NNNN_x.sql`.

## 2. Single responsibility

Good — each piece does one thing and an orchestrator composes them:

```ts
// enrichment/server-event.enricher.ts
enrich(event, ctx) {
  const path = this.paths.sanitize(event.path);
  const routeTemplate = this.routes.normalize(path, event.routeTemplate);
  const geo = this.geo.lookup(event.ip);
  ...
}
```

Bad — one method that parses, looks up, verifies and decides:

```ts
async authenticate(raw) { /* parse prefix, query DB, hmac, compare, check expiry, check app… */ }
```

Split it: `parseApiKey()` (pure) → `ApiKeyVerifier.matches()` → `AppKeyAuthenticator.authenticate()` (orchestrates).

## 3. Naming

| Thing | Rule | Example |
|---|---|---|
| API files | `<kebab-domain>.<role>.ts`, singular | `endpoint.controller.ts`, `ip.anonymizer.ts` |
| API classes | `<Domain><Role>` | `EndpointController`, `IpAnonymizer` |
| Container keys | plural ROUTES group | `controllers.endpoints` |
| Web components | PascalCase `.tsx`, named export | `EndpointsView.tsx` |
| Web hooks | `useX.ts` | `useEndpointStats.ts` |
| Other web modules | camelCase `.ts` | `apiError.ts` |
| DTOs | `<Noun><Qualifier>Dto` in `shared/src/dto/<group>.ts` | `EndpointStatsDto` |
| Query schemas | `<leaf><Group>QuerySchema` in `shared/src/schemas/` | `endpointListQuerySchema` |
| Enums | `*_VALUES` arrays + derived type | `IDENTITY_SOURCE_VALUES` |
| SQL | UPPERCASE keywords, snake_case, `$n` params, indexes `idx_<table>_<cols>` | |
| Exports | named only (default only where Next.js requires it) | |

## 4. No magic strings

- API paths → `ROUTES`; socket namespaces/events → `SOCKET_NAMESPACES` / `SOCKET_EVENTS`.
- Headers → `INGEST_HEADERS`; error codes → `ERROR_CODES`.
- Dashboard links → `apps/web/src/lib/pages.ts` (`PAGES.endpointDetail(id)`).
- Enum values → `packages/shared/src/constants/*`, mirrored by DB CHECKs (a test enforces parity).

## 5. Errors, logging, PII

- Throw an `AppError` subclass; never `try/catch` in controllers. The error handler renders
  `{ error: { code, message, details?, requestId } }`.
- Logs are JSON lines via `apps/api/src/lib/logger.ts`; emails are masked (`s***@libas.in`).
- Never log tokens, keys or full emails. Never store query strings, bodies or error messages.
- Never build an `href`/`src` from ingested data on the dashboard.

## 6. Testing

- vitest everywhere. Unit-test pure functions and services with hand-written fakes
  (`implements Pick<Repo, 'method'>`).
- DB tests are `*.integration.test.ts`, run with `RUN_DB_TESTS=1` against the compose Postgres.
- Contract tests: every ROUTES leaf is registered and has an `api.*` client function; zod limits
  equal DB CHECKs; snippet payloads validate against the shared schemas.

## 7. Comments

`/** WHY … */` above every exported class/function explaining *why it exists*, CAPS for hard rules
(ONLY/NEVER/MUST), `// ─── Section ───` banners in long files.
