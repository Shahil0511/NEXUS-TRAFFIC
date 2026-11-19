# ADR 0008 — The environment dimension (prod / staging / dev)

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
  **Supersedes** the [ADR 0001](0001-contract-and-naming.md) row "App identity … **No environment
  dimension**: staging uses its own slug". Separate `<slug>-dev` apps remain allowed.
- **Context:** staging deployments and developer laptops (including the dev-cookie traffic of
  `localhost` sessions) sent events with the production key, and every dashboard number mixed them
  in. A second app per environment worked, but nobody registered one, and a typo in a slug could
  not be detected. Teams asked for one switch per deployment.
- **Decision:**
  1. **Values** `ENVIRONMENT_VALUES = ['prod','staging','dev']`, `DEFAULT_ENVIRONMENT = 'prod'`
     (`packages/shared/src/constants/traffic.ts`).
  2. **Wire:** optional `environment` on BOTH envelopes, **lenient**: `z.string().min(1).max(32)`
     (`INGEST_LIMITS.maxEnvironmentWireLength`), never a `z.enum`. A typo must never `400` a whole
     batch, and a browser `400` happens before auth, so it could not even be attributed. The API
     checks the value; an unknown one is a `FIELD_DROPPED` warning (field `environment`) on the
     first stored event and is treated as absent.
  3. **Resolution** in one pure function, `resolveEnvironment` (`apps/api/src/domain/environment.ts`):
     - browser: a **loopback page origin** (`localhost`, `*.localhost`, `*.local`, `127.0.0.0/8`,
       `[::1]`; Origin, else Referer) is always `dev`, whatever the claim; otherwise the valid
       claim, else `prod`;
     - server: the valid claim, else `prod`. **No IP heuristic** — a misconfigured proxy can make
       production calls look loopback.
  4. **Storage:** `environment text NOT NULL DEFAULT 'prod'` + CHECK on `api_requests` and
     `web_events` (`apps/api/migrations/0007_event_environment_and_client_context.sql`). The
     constant default is metadata-only (no partition rewrite), history reads as `prod`, and older
     code can still insert, so a rollback is safe. Environment is a separate insert field, **not** an
     actor column (the 16-column actor parity test is unchanged).
  5. **Dashboard filter:** `timeWindowQuerySchema.env` = `ENVIRONMENT_FILTER_VALUES` (`…, 'all'`),
     `.optional()` (not `.default()`, so existing typed query literals keep compiling); absent means
     `prod`, applied in the API. `TrafficFilter.environments` is **required**, so every statement
     builder has to emit the predicate (`environmentConditions` in
     `apps/api/src/repositories/api-request-query.repository.ts`), and a test runs every public read
     method and checks each `FROM traffic.<table>` alias carries it.
  6. **Live is production only:** `LiveFeed` drops non-prod rows, the online / snapshot SQL add
     `environment = 'prod'`; no change to socket rooms or scope keys. **Integration Health is not
     filtered** — it shows the environment mix, because it also diagnoses staging wiring.
- **Consequences:**
  - One app and one key can serve every environment; the guide (chapters 01 and 09) explains both
    options. A browser on `localhost` still needs its origin registered for the app.
  - A deployment that forgets `NEXUS_ENVIRONMENT` lands in `prod` — the Integration page's
    environment mix is how a team notices.
  - The SDKs send the field only when it is valid; the React tracker defaults to `dev` on a loopback
    host and otherwise leaves the decision to the server.
