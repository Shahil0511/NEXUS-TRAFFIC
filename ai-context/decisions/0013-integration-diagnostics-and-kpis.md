# ADR 0013 — Integration diagnostics, coverage KPIs and the integration level

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
- **Context:** the Integration page (S5) could say *that* events were rejected or anonymous, not
  *why*: rejection messages are never stored, the SSO cookie outcome was only in memory, and "linked"
  / "identified" were defined differently on different pages. Teams also asked "are we done?", and
  page grouping of dynamic routes was a guess.
- **Decision:**
  1. **Three hourly aggregate tables** (not partitioned; `bucket_hour` aligned like
     `ingest_counters`; upserted additively with `unnest` + `GROUP BY`, on the write pool, after the
     batch committed and each in its own try/catch so a counter failure never fails ingest):
     - `traffic.ingest_rejections (app, source, sdk '', code, schema_path '', hour, rejected)` —
       `apps/api/migrations/0010_ingest_rejections.sql`;
     - `traffic.pii_detections (app, source, field, kind, hour, detections)` — 0011, ADR 0010;
     - `traffic.sso_cookie_outcomes (app, outcome, beacon_origin, hour, beacons)` — 0012.
     `''` means "none" (a NULL cannot be in the primary key); the read side maps it to `null`.
  2. **Rejection codes** `INGEST_REJECTION_CODE_VALUES` = the per-event codes (`INVALID_EVENT`,
     `EVENT_TIME_OUT_OF_RANGE`, `PATH_OUTSIDE_APP`, `DB_CONSTRAINT`, recorded by `IngestService`)
     plus two envelope-level refusals recorded only once the app is authenticated: server
     `INVALID_ENVELOPE` (validated after key auth) and browser `ORIGIN_NOT_ALLOWED`.
     `rejectionRecorderMiddleware(repo, source, clock, logger)`
     (`apps/api/src/http/middleware/rejection-recorder.middleware.ts`) is mounted ONLY on POST
     `ingest.server` and `ingest.browser`, records on `finish`, fire-and-forget; config-route
     failures are never recorded.
  3. **No sender-chosen text in rows.** `normalizeSdkLabel` (`apps/api/src/domain/sdk-label.ts`)
     keeps an `name@version` label only if it matches the strict pattern, else `''` (also prevents the
     `char_length(sdk) <= 100` CHECK from losing a whole upsert); for `ORIGIN_NOT_ALLOWED` the sdk is
     ALWAYS `''` (only a public key is proven). The server envelope's label comes from `X-Nexus-SDK`,
     else the raw body's `sdk {name, version}`. `normalizeSchemaPath`
     (`apps/api/src/domain/schema-path.ts`): numbers → `*`, the key after `props` → `*`, any segment
     not `^[A-Za-z][A-Za-z0-9]{0,39}$` → `*`, joined with `.`, cut at 128; fixed paths for
     `EVENT_TIME_OUT_OF_RANGE` (`occurredAt`), `PATH_OUTSIDE_APP` (`path`) and `DB_CONSTRAINT` (the
     constraint name when known). The zod message is NEVER stored. At most
     `REJECTION_MAX_DISTINCT_PER_BATCH` (20) keys per batch; the rest fold into `schema_path ''`
     (so up to one extra fold key per code, bounded by the 6 codes).
  4. **SSO cookie outcomes** per browser batch: `SSO_COOKIE_OUTCOME_VALUES` = `ok` + every failure
     reason of `@nexus/auth` (typed as `CookieFailureReason`, a compile-time test asserts the two
     sets are equal both ways) + `no-email` (a valid cookie whose email is implausible).
     `BEACON_ORIGIN_VALUES` compares the request Origin with `new URL(PUBLIC_ORIGIN).origin`.
     Nothing is recorded for replays (ADR 0012).
  5. **Coverage KPIs — one SQL definition** in `apps/api/src/repositories/coverage-predicates.ts`,
     literals from typed constants:
     - **identified** = `user_key IS NOT NULL` (`IDENTIFIED_SQL`) — Applications page: both sources
       COMBINED; Integration Health: PER SOURCE (the copy on each page says which);
     - **linkable** = `api_requests` with `kind = 'http'` AND `ua_device IN LINKABLE_DEVICE_CLASSES`
       (desktop, mobile, tablet; SSR, server-to-server calls, bots and streams can never link);
       **linked** = linkable with `session_id`; **pageViewLinked** = linkable with `page_view_id`.
       `AppTrafficDto.linkedPct` is REDEFINED on this denominator.
     - **release coverage** = events with `release` ÷ events, per source, plus the newest release.
     A ratio is `null` below `COVERAGE_MIN_EVENTS` (20).
  6. **Integration level** `INTEGRATION_LEVEL_VALUES` (`integrationLevelOf`,
     `apps/api/src/domain/integration-health.ts`): `not_connected` (status `never`) · `partial`
     (status `stale`, or only one source has events) · `connected` (both sources) · `complete`
     (connected AND linking ≥ `COVERAGE_TARGET_RATIO` 0.8 AND browser identity ≥ 0.8 AND every
     source's release ratio ≥ `RELEASE_COVERAGE_TARGET` 0.95 AND none of `exposed_key`,
     `pii_detected`, `app_disabled`; a null ratio is not complete). Coverage is shown as numbers plus
     the level, not as warnings; the one new warning is `pii_detected`.
  7. **`AppIntegrationHealthDto`** gains `identityCoverage` and `releases` (always one row per source,
     in `INGEST_SOURCE_VALUES` order), `linkingCoverage`, `environments` (ordered by
     `INGEST_SOURCE_VALUES`, then events), `piiDetections` and `rejections` (busiest first, rejections
     ≤ `MAX_REJECTION_ROWS_PER_APP` 20 per app, limited in SQL), `ssoCookieOutcomes` and `level`.
     Integration Health is not filtered by environment (ADR 0008).
  8. **Aggregate retention:** the three tables are pruned after `AGGREGATE_RETENTION_DAYS` (90):
     `RetentionJob` → `AggregateRetentionService.deleteExpired` →
     `AggregateRetentionRepository.deleteExpired(cutoff, exec)` — same verb at every layer, inside the
     existing retention advisory lock, after `partitions.dropExpired`. `ingest_counters` is unchanged.
  9. **Index** `idx_api_requests_page_view_id ON traffic.api_requests (page_view_id) WHERE
     page_view_id IS NOT NULL` (`apps/api/migrations/0008_api_requests_page_view_index.sql`) serves the
     `page_view_id IN (subquery)` probe of `listPageApiCalls` (closing the ADR 0007 note).
     **BRIN: not added** — monthly partitions, the PK btree `(occurred_at, event_id)` and
     `(app_id, occurred_at DESC)` already serve every window scan.
  10. **Page-id cut-over (A1):** the 1.1.0 trackers send `routeTemplate` (Next: from `useParams()`,
      `:name` / catch-all `:name*`; React Router: `matchRoutes()`), and `BrowserEventEnricher` keeps
      it only when `isPlausibleRouteTemplate` (`apps/api/src/domain/route-template.ts`) holds —
      within the base path, same segment count (a trailing `:name*` may match more), every static
      segment equal case-insensitively — else `FIELD_DROPPED` (`routeTemplate`) and the server
      guesses. `toPageId` derives from the template, so dynamic routes of an upgraded app get new
      page ids from the upgrade on. **No backfill.**
- **Consequences:**
  - "Why" is answerable from the dashboard without storing any payload: codes, normalised field
    paths, field names and counts only, kept 90 days.
  - Old page links of dynamic routes keep working for the old window only (same trade-off as
    ADR 0007); the CHANGELOG and PROGRESS record the cut-over.
  - The `latest_release` aggregation builds one array per SDK row — fine at today's volume
    (≈ 28k rows a month), to revisit if the health window grows.
