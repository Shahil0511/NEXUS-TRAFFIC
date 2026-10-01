-- intent: hourly ingest bookkeeping per app and source (accepted / duplicates / rejected /
--         rate-limited events), upserted additively by IngestCounterRepository.increment and read
--         by the Integration Health page. bucket_hour is aligned to Asia/Kolkata hours (the
--         reporting timezone, see bucketExpr in apps/api/src/db/sql.ts).

CREATE TABLE traffic.ingest_counters (
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  source text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  accepted integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  rate_limited integer NOT NULL DEFAULT 0,
  CONSTRAINT ingest_counters_pkey PRIMARY KEY (app_id, source, bucket_hour),
  -- INGEST_SOURCE_VALUES
  CONSTRAINT ingest_counters_source_check CHECK (source IN ('server', 'browser')),
  CONSTRAINT ingest_counters_accepted_check CHECK (accepted >= 0),
  CONSTRAINT ingest_counters_duplicates_check CHECK (duplicates >= 0),
  CONSTRAINT ingest_counters_rejected_check CHECK (rejected >= 0),
  CONSTRAINT ingest_counters_rate_limited_check CHECK (rate_limited >= 0)
);
