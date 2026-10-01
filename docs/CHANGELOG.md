# Changelog — Data Nexus Traffic ingest contract

The public contract other teams integrate against (`docs/integration/`, published at
`https://nexus.libas.in/traffic/api/docs/`, machine-readable in `docs/openapi.json`).

**Policy**

- Within **v1**, changes are **additive only**: new optional fields, new event types, new warning or
  rejection codes, higher limits. Existing integrations keep working unchanged.
- Unknown fields are ignored by the server, so newer senders work against older servers.
- A **breaking** change (removing/renaming a field, tightening a limit, changing a meaning) ships as
  `/v2` next to `/v1`, with notice to every registered app and a migration window.
- Every contract change updates `packages/shared` first, then this file, the guide and
  `docs/openapi.json` (`npm run openapi:emit`; CI runs `npm run openapi:emit -- --check`).

Format: newest first. Dates are IST.

## v1 — 2026-10-01 (draft, S1)

**Added**

- `POST /v1/ingest/server` — backend API-call events, secret key in `X-Nexus-Key`, up to 500 events /
  512 KiB per request, `?dryRun=1`. Required event fields: `eventId`, `occurredAt`, `method`, `path`,
  `status`, `durationMs`. Optional: `kind`, `routeTemplate`, `ip`, `userEmail`, `requestId`,
  `userAgent`, `requestBytes`, `responseBytes`, `errorCode`, `release`, `sessionId`, `pageViewId`.
- `GET /v1/ingest/verify` — key check (either kind) returning `{app, keyKind, contractVersion, serverTime}`.
- `POST /v1/ingest/browser` — **specified** (envelope `{key, sentAt, sessionId, anonymousId?, user?, client?, events[1..50]}`,
  event types `page_view`, `page_time`, `tool_use`, `custom`); the endpoint goes live in a later step.
- `202` result `{accepted, duplicates, rejected[], warnings[], dryRun?}`; error envelope
  `{error: {code, message, details?, requestId?}}`; event time window −7 days / +5 minutes.
- Public guide (chapters 00–11 + per-app appendix), OpenAPI 3.1 document, example batches and
  reference snippets (Express CJS/ESM, NestJS, FastAPI ASGI, curl).

**Fixed (before release)**

- Envelope problems on `POST /v1/ingest/server` — empty body, `events` missing/empty or too many —
  now answer `400 INVALID_ENVELOPE`, as chapters 4 and 11 already documented. The first S1 build
  answered `415` for an empty body sent with `Content-Type: application/json`, and `VALIDATION_ERROR`
  for a malformed envelope. Senders that treat every `400` the same (the guide's advice) are unaffected.
