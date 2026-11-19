-- intent: hourly counts of refused events per app, source, SDK, code and normalised schema path
--         (ADR 0013), upserted additively by the ingest rejection recorder and read by the
--         Integration Health page ("why were my events rejected?"). Only CODES and normalised
--         paths are stored — never zod messages or values. '' means "none / unknown" (a NULL
--         cannot be part of the primary key). bucket_hour is aligned like ingest_counters (0006).
--         Pruned after AGGREGATE_RETENTION_DAYS by the retention job.

CREATE TABLE traffic.ingest_rejections (
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  source text NOT NULL,
  sdk text NOT NULL DEFAULT '',
  code text NOT NULL,
  schema_path text NOT NULL DEFAULT '',
  bucket_hour timestamptz NOT NULL,
  rejected integer NOT NULL,
  CONSTRAINT ingest_rejections_pkey PRIMARY KEY (app_id, source, sdk, code, schema_path, bucket_hour),
  -- INGEST_SOURCE_VALUES
  CONSTRAINT ingest_rejections_source_check CHECK (source IN ('server', 'browser')),
  CONSTRAINT ingest_rejections_sdk_check CHECK (char_length(sdk) <= 100),
  -- INGEST_REJECTION_CODE_VALUES (packages/shared/src/errors.ts)
  CONSTRAINT ingest_rejections_code_check CHECK (
    code IN (
      'INVALID_EVENT', 'EVENT_TIME_OUT_OF_RANGE', 'PATH_OUTSIDE_APP', 'DB_CONSTRAINT',
      'INVALID_ENVELOPE', 'ORIGIN_NOT_ALLOWED'
    )
  ),
  -- INGEST_LIMITS.maxSchemaPathLength; dotted identifiers and `*` only.
  CONSTRAINT ingest_rejections_schema_path_check CHECK (
    char_length(schema_path) <= 128 AND schema_path ~ '^[A-Za-z0-9_.*]*$'
  ),
  CONSTRAINT ingest_rejections_rejected_check CHECK (rejected >= 0)
);

CREATE INDEX idx_ingest_rejections_bucket_hour ON traffic.ingest_rejections (bucket_hour);
