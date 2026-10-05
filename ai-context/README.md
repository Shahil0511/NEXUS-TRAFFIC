# ai-context — START HERE

This folder is the **project memory** of Data Nexus Traffic. It is written for humans first
(new developers, the Team Lead) and equally for future AI coding sessions. If you only read one
folder before touching the code, read this one.

## The project in 10 lines

1. **What:** a real-time traffic analytics platform for the apps on `nexus.libas.in`.
2. **Collects:** backend API calls (route, duration, status, IP, user email) and frontend usage
   (pages, time spent, UI tools used, journeys).
3. **How data arrives:** other teams add a small middleware / React hook to *their* apps that POSTs
   events to our **ingest API**. We never edit their code (see the hard rule below).
4. **Server:** Express 5 + Socket.io (`apps/api`) → enriches (IP → geo, user agent, identity) → PostgreSQL.
5. **Dashboard:** Next.js 16 (`apps/web`) behind the company SSO, with live updates over Socket.io.
6. **Contracts:** `packages/shared` holds every route, DTO, enum and ingest schema — the single source of truth.
7. **Auth:** `packages/auth` verifies the portal's `access_token` cookie (HS256, `LIBAS_JWT_SECRET`).
8. **Deploy:** the Team Lead follows [`DEPLOY.md`](../DEPLOY.md); updates are `bash scripts/deploy.sh` (`git pull` + `docker compose up -d --build`).
9. **Public guide for other teams:** `https://nexus.libas.in/traffic/api/docs/` (built from `docs/integration/`).
10. **Style:** SOLID, one function = one job, and VS Code ctrl-click navigation from a UI click down to SQL.

> **Hard rule:** never create, edit or delete anything in `D:\server` (the other teams' projects).
> We publish an API + guide; *they* wire it in. The one exception is `D:\server\EBO_SALES` (the
> user's own app, integrated by us as the reference integration — [ADR 0003](decisions/0003-ebo-sales-reference-integration.md)).

## Reading order

| # | File | Read it when you want to… |
|---|---|---|
| 1 | [01-project-overview.md](01-project-overview.md) | understand the problem, the data we collect and why |
| 2 | [02-architecture.md](02-architecture.md) | see the big picture: containers, URLs, how a request flows |
| 3 | [03-code-navigation.md](03-code-navigation.md) | know **where to start reading code** and follow a feature end to end |
| 4 | [04-how-to-recipes.md](04-how-to-recipes.md) | add a page, a metric, a contract field, a migration, an env var |
| 5 | [05-conventions.md](05-conventions.md) | write code that fits: SOLID rules, naming, no magic strings |
| 6 | [06-process.md](06-process.md) | run, test, commit, deploy, roll back |
| 7 | [07-data-model.md](07-data-model.md) | understand every table/column and how personal data is protected |
| 8 | [08-integration-contract.md](08-integration-contract.md) | know what other teams send us (one-page summary) |
| 9 | [09-local-development.md](09-local-development.md) | run locally: `npm run dev:setup` once, then `npm run dev` (api + dashboard, no sign-in in dev) |
| — | [GLOSSARY.md](GLOSSARY.md) | look up a term (one noun per concept) |
| — | [decisions/](decisions/) | know *why* something is the way it is (ADRs) |
| — | [PROGRESS.md](PROGRESS.md) | see what is done, what is next, known issues |

## Keeping this folder true

- Every implementation step ends with a new entry in `PROGRESS.md`.
- Any change to architecture, the ingest contract, tables or conventions updates the matching file
  here **in the same commit**.
- A new significant decision gets a new file in `decisions/` (context → decision → consequences).
- A test (`apps/api/test/ai-context-links.test.ts`, part of `npm test`) checks that every repo path mentioned in
  these documents exists, so they cannot silently rot.
