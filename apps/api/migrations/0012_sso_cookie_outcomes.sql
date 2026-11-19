-- intent: hourly counts of SSO cookie verification outcomes of browser batches (ADR 0013), per
--         app, outcome and beacon origin (same-origin / cross-origin / none) — explains WHY browser
--         events are anonymous. Replayed batches are not counted. Pruned after
--         AGGREGATE_RETENTION_DAYS by the retention job.

CREATE TABLE traffic.sso_cookie_outcomes (
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  outcome text NOT NULL,
  beacon_origin text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  beacons integer NOT NULL,
  CONSTRAINT sso_cookie_outcomes_pkey PRIMARY KEY (app_id, outcome, beacon_origin, bucket_hour),
  -- SSO_COOKIE_OUTCOME_VALUES (packages/shared/src/constants/traffic.ts)
  CONSTRAINT sso_cookie_outcomes_outcome_check CHECK (
    outcome IN (
      'ok', 'no-cookie', 'no-secret', 'malformed', 'bad-alg', 'bad-signature', 'expired',
      'not-yet-valid', 'wrong-type', 'no-email'
    )
  ),
  -- BEACON_ORIGIN_VALUES
  CONSTRAINT sso_cookie_outcomes_beacon_origin_check CHECK (
    beacon_origin IN ('same_origin', 'cross_origin', 'none')
  ),
  CONSTRAINT sso_cookie_outcomes_beacons_check CHECK (beacons >= 0)
);

CREATE INDEX idx_sso_cookie_outcomes_bucket_hour ON traffic.sso_cookie_outcomes (bucket_hour);
