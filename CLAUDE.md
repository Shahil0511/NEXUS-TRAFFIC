# Data Nexus Traffic — rules for AI sessions

**START HERE → [ai-context/README.md](ai-context/README.md).** It explains the project, the reading
order, where to start in the code, and the current status ([ai-context/PROGRESS.md](ai-context/PROGRESS.md)).

## Hard rules

1. **NEVER create, edit or delete anything under `D:\server`.** Those are other teams' apps. We deliver
   the ingest API, the public guide (`docs/integration/`) and reference snippets/SDKs; they integrate.
2. **`packages/shared` is the contract.** Change it first (routes, schemas, enums, DTOs), then migrations,
   then api/web, then docs. Never hand-type an API path, socket event name, header or enum value.
3. **Follow [ai-context/05-conventions.md](ai-context/05-conventions.md):** SOLID, one function = one job,
   ctrl-click navigable chain (ROUTES → route → controller → service → repository → SQL), same verb at
   every layer, concrete class deps, `@see` breadcrumbs, named exports.
4. **Decisions live in [ai-context/decisions/](ai-context/decisions/).** ADR 0001 is canonical; to change a
   decision, add an ADR.
5. **Keep ai-context true:** finish every step with a [PROGRESS.md](ai-context/PROGRESS.md) entry and update
   any ai-context file your change affects, in the same commit.
6. **PII:** never log full emails, tokens or keys; never store query strings, bodies or error messages.

## Gates before committing

`npm run typecheck && npm test` (and `RUN_DB_TESTS=1 npm run test:db` once Postgres is involved).
