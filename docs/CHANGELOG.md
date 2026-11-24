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

## v1 — 2026-11-24 (dashboard read change)

Nothing changes on the wire: every field, limit and response stays as it was, and stored events are
not rewritten. What changes is how the dashboard counts time on page, so the guide now spells out the
recipe a hand-written tracker needs.

**Changed**

- The guide's time-on-page recipe (chapter 3) now lists the **visible tick**: while the tab stays
  visible, send a `page_time` delta every 5 s with `reason: "idle"`, `final: false`. The reference
  React tracker has always done this on its flush tick (1.0.0 and 1.1.0).

**Dashboard (not part of the wire contract)**

- Each `page_time` row is credited **at most 60 s** of visible time (`VISIBLE_DELTA_CREDIT_CAP_MS`
  in `packages/shared`) wherever the dashboard adds up visible time: person days and timeline, the
  Visits list and visit header, visit steps, and the Pages average / median. The stored `visibleMs`
  is kept as sent. A much longer delta means the tick did not run (a sleeping laptop, a frozen tab),
  so the old numbers that credited it in full go down.
- Apps on the reference SDK (1.0.0 and 1.1.0) are unaffected apart from such gaps. A tracker that
  sends one long delta per view (only on hidden, route change or `pagehide`) is now credited at most
  60 s per delta: add the visible tick to keep its numbers.

## v1 additive — 2026-11 (data quality, "Phase A")

Everything below is **optional for senders and additive**: an integration built against the
2026-10 contract keeps working unchanged. Reference SDKs `@nexus/react`, `@nexus/node` and
`@nexus/express` are now **1.1.0** (new immutable tarballs; 1.0.0 keeps working).

**Added**

- **`environment`** (`prod` | `staging` | `dev`, optional) on **both** envelopes. Lenient on the wire
  (any string ≤ 32 chars): an unknown value is ignored with a `FIELD_DROPPED` warning (field
  `environment`) on the first stored event and the batch counts as `prod`. Browser batches from a
  loopback page origin (`localhost`, `*.localhost`, `*.local`, `127.0.0.0/8`, `[::1]`) are always
  `dev`. Absent → `prod`, which is also what all earlier data reads as. Separate `<slug>-dev` apps
  remain allowed.
- Browser envelope **`release`** (≤ 64 chars) — the frontend build, as servers already send per event.
- Browser **`client.replay`** (boolean): `true` on a batch resent on a later page load by the
  persistent retry queue. Replays are stored anonymous (the SSO cookie is not used for them).
- Browser `client.tz` / `client.lang` are now **stored** (they were accepted before). A value that is
  not an IANA zone / language tag is dropped with `FIELD_DROPPED` (`client.tz` / `client.lang`).
- **`POST /v1/ingest/config`** — the browser SDK's remote config. `text/plain` (or JSON) body
  `{key, client?: {sdk, version}}` with the publishable key; `200 {contract, version, enabled,
  disabledModules, maxAgeMs}` with `Cache-Control: no-store`. `401` / `403` with `APP_DISABLED`,
  `BROWSER_INGEST_DISABLED`, `INVALID_API_KEY`, `WRONG_KEY_TYPE` or `SECRET_KEY_EXPOSED` = the kill
  switch. Remote config can only **disable** modules; module switches need SDK ≥ 1.1.0, the kill
  switch is enforced at ingest for every version.
- Warning code **`FIELD_REDACTED`**: the ingest PII detector found an email, phone number, PAN,
  GSTIN or Aadhaar number in a field and replaced it (paths, labels, prop values: `:email`, `:phone`,
  …; `tool` / `name`: `redacted`) or removed it (a prop key; `errorCode`, `requestId`, `release`).
  Events are never rejected for it. Stored `path` / `referrerPath` also get a **segment scrub**: a
  whole segment that is a bare 10-digit mobile number or a checksum-valid 12-digit Aadhaar number
  becomes `:phone` / `:aadhaar` (a 10-digit id starting 6–9 is affected in the raw path only).
- Browser `routeTemplate` is now **checked** against the path (base path, segment count, fixed
  segments; `:name*` is a trailing catch-all). A template that does not fit is dropped with
  `FIELD_DROPPED` (`routeTemplate`) and the server guesses, as for senders without one.

**Changed**

- **Readable browser errors:** error responses (`400`/`401`/`403`/`413`/`415`/`429`) of
  `POST /v1/ingest/browser` and `/v1/ingest/config` now carry `Access-Control-Allow-Origin` +
  `Access-Control-Allow-Credentials` for any origin registered for **some** app, before the key is
  checked — a cross-origin tracker can read the kill codes. Success still requires the app's own
  origin list.
- **IP failure limiter:** only `MISSING_API_KEY`, `INVALID_API_KEY`, `WRONG_KEY_TYPE` and
  `ORIGIN_NOT_ALLOWED` count toward the per-IP failed-key limit. The kill codes (`APP_DISABLED`,
  `BROWSER_INGEST_DISABLED`, `SECRET_KEY_EXPOSED`) no longer do, so a killed app's old trackers
  behind one office NAT cannot block every other app from that IP. Register every page origin of
  your app: refused origins still count.
- **Page-id cut-over:** the 1.1.0 React tracker sends `routeTemplate` (Next.js from `useParams()`,
  React Router from `matchRoutes()`), so page views of dynamic routes are grouped by their real route
  from the day an app upgrades. Page ids derive from the template, so those pages get **new ids**;
  older data keeps its old grouping (no backfill).
- **Header propagation** in the React tracker is now **on by default for same-origin calls**
  (`fetch` and `XMLHttpRequest`), with `propagateHeadersTo` for exact extra origins, and an early
  entry `@nexus/react/early` (`installNexusEarly`) so API calls made before hydration are linked.
- The React tracker keeps failed batches in a **persistent retry queue** (localStorage, per key,
  bounded: 20 batches / 128 KiB / 24 h / 3 replays).
- Server SDKs and snippets: `environment` option (default `NEXUS_ENVIRONMENT`, sent only when valid);
  `release` defaults to `NEXUS_RELEASE` in `@nexus/express`; FastAPI
  `NexusClient(url, key, *, environment=None, …)` (`sdk_name` / `sdk_version` are keyword-only).

**Dashboard (not part of the wire contract)**

- Environment filter (`?env=`, default production) on every analytics page; Live is production only.
- Integration page: integration level, identity / linking / release coverage, environment mix, PII
  detections, rejection reasons and SSO cookie outcomes (kept 90 days, counts only).
- Apps page: remote config dialog (kill switch + module switches, optimistic version).


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
