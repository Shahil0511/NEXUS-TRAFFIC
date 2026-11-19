-- intent: the environment dimension (ADR 0008) on both event tables, plus the browser client
--         context the tracker already sends (client.tz, client.lang) and the frontend release
--         (envelope `release`) on web_events. ADD COLUMN with a constant DEFAULT is metadata-only
--         (no rewrite of the monthly partitions); history reads as 'prod', so it stays visible under
--         the default dashboard filter, and older code can still insert (safe rollback). Limits
--         mirror INGEST_LIMITS (packages/shared/src/constants/ingest.ts).

-- ─── api_requests ────────────────────────────────────────────────────────────

ALTER TABLE traffic.api_requests ADD COLUMN environment text NOT NULL DEFAULT 'prod';

-- ENVIRONMENT_VALUES (packages/shared/src/constants/traffic.ts)
ALTER TABLE traffic.api_requests
  ADD CONSTRAINT api_requests_environment_check CHECK (environment IN ('prod', 'staging', 'dev'));

-- ─── web_events ──────────────────────────────────────────────────────────────

ALTER TABLE traffic.web_events
  ADD COLUMN environment text NOT NULL DEFAULT 'prod',
  ADD COLUMN client_tz text NULL,
  ADD COLUMN client_lang text NULL,
  ADD COLUMN release text NULL;

ALTER TABLE traffic.web_events
  -- ENVIRONMENT_VALUES
  ADD CONSTRAINT web_events_environment_check CHECK (environment IN ('prod', 'staging', 'dev')),
  -- INGEST_LIMITS.maxClientTzLength
  ADD CONSTRAINT web_events_client_tz_check CHECK (client_tz IS NULL OR char_length(client_tz) <= 64),
  -- INGEST_LIMITS.maxClientLangLength
  ADD CONSTRAINT web_events_client_lang_check CHECK (
    client_lang IS NULL OR char_length(client_lang) <= 16
  ),
  -- INGEST_LIMITS.maxReleaseLength
  ADD CONSTRAINT web_events_release_check CHECK (release IS NULL OR char_length(release) <= 64);
