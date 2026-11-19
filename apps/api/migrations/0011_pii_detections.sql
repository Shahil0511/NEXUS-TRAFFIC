-- intent: hourly counts of personal data redacted by the ingest PII scrubber (ADR 0010), per app,
--         source, field and kind. Counts ONLY — the matched value is never stored or logged. Read
--         by the Integration Health page (warning `pii_detected`). Pruned after
--         AGGREGATE_RETENTION_DAYS by the retention job.

CREATE TABLE traffic.pii_detections (
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  source text NOT NULL,
  field text NOT NULL,
  kind text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  detections integer NOT NULL,
  CONSTRAINT pii_detections_pkey PRIMARY KEY (app_id, source, field, kind, bucket_hour),
  -- INGEST_SOURCE_VALUES
  CONSTRAINT pii_detections_source_check CHECK (source IN ('server', 'browser')),
  -- PII_FIELD_VALUES (packages/shared/src/constants/pii.ts)
  CONSTRAINT pii_detections_field_check CHECK (
    field IN (
      'path', 'route_template', 'referrer_path', 'label', 'prop_key', 'prop_value', 'tool',
      'name', 'error_code', 'request_id', 'release'
    )
  ),
  -- PII_KIND_VALUES
  CONSTRAINT pii_detections_kind_check CHECK (kind IN ('email', 'phone', 'pan', 'gstin', 'aadhaar')),
  CONSTRAINT pii_detections_detections_check CHECK (detections >= 0)
);

CREATE INDEX idx_pii_detections_bucket_hour ON traffic.pii_detections (bucket_hour);
