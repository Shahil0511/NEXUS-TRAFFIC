-- intent: one row per backend API call reported by an app's server middleware (POST
--         /v1/ingest/server). Monthly range partitions on occurred_at (created by
--         traffic.ensure_partitions, see 0001), NO default partition. Idempotent on
--         (occurred_at, event_id). Limits mirror packages/shared/src/constants/ingest.ts
--         (INGEST_LIMITS) and the enums mirror packages/shared/src/constants/traffic.ts.
--         Query strings, bodies and error messages are NEVER stored.

CREATE TABLE traffic.api_requests (
  -- ─── time + idempotency ────────────────────────────────────────────────────
  occurred_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  clock_skew_ms bigint NULL,
  -- ─── what was called ───────────────────────────────────────────────────────
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  endpoint_id uuid NOT NULL,
  kind text NOT NULL,
  method text NOT NULL,
  route_template text NOT NULL,
  path text NOT NULL,
  status_code smallint NOT NULL,
  duration_ms real NOT NULL,
  request_bytes bigint NULL,
  response_bytes bigint NULL,
  error_code text NULL,
  release text NULL,
  -- ─── correlation ───────────────────────────────────────────────────────────
  request_id text NULL,
  session_id uuid NULL,
  page_view_id uuid NULL,
  -- ─── identity ──────────────────────────────────────────────────────────────
  user_email text NULL,
  user_key bytea NULL,
  claimed_email text NULL,
  identity_source text NOT NULL,
  -- ─── network + geo + client ────────────────────────────────────────────────
  ip inet NULL,
  ip_hash bytea NULL,
  ip_class text NOT NULL,
  geo_country text NULL,
  geo_region text NULL,
  geo_city text NULL,
  geo_lat real NULL,
  geo_lon real NULL,
  ua_browser text NULL,
  ua_os text NULL,
  ua_device text NULL,
  sdk text NULL,

  CONSTRAINT api_requests_pkey PRIMARY KEY (occurred_at, event_id),
  -- SERVER_EVENT_KIND_VALUES
  CONSTRAINT api_requests_kind_check CHECK (kind IN ('http', 'stream')),
  -- HTTP_METHOD_VALUES
  CONSTRAINT api_requests_method_check CHECK (
    method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')
  ),
  -- '^/' blocks stored `javascript:` values from ever reaching an href.
  CONSTRAINT api_requests_route_template_check CHECK (
    route_template ~ '^/' AND char_length(route_template) <= 256
  ),
  CONSTRAINT api_requests_path_check CHECK (path ~ '^/' AND char_length(path) <= 512),
  CONSTRAINT api_requests_status_code_check CHECK (status_code BETWEEN 100 AND 599),
  CONSTRAINT api_requests_duration_ms_check CHECK (duration_ms >= 0 AND duration_ms <= 3600000),
  CONSTRAINT api_requests_request_bytes_check CHECK (request_bytes IS NULL OR request_bytes >= 0),
  CONSTRAINT api_requests_response_bytes_check CHECK (response_bytes IS NULL OR response_bytes >= 0),
  -- ERROR_CODE_PATTERN — codes only, never messages.
  CONSTRAINT api_requests_error_code_check CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  CONSTRAINT api_requests_release_check CHECK (release IS NULL OR char_length(release) <= 64),
  CONSTRAINT api_requests_request_id_check CHECK (
    request_id IS NULL OR char_length(request_id) <= 128
  ),
  -- IDENTITY_SOURCE_VALUES
  CONSTRAINT api_requests_identity_source_check CHECK (
    identity_source IN ('sso_cookie', 'app_attested', 'client_claimed', 'anonymous')
  ),
  -- IDENTIFIED_SOURCE_VALUES: ONLY verified sources fill user_email.
  CONSTRAINT api_requests_identified_email_check CHECK (
    (user_email IS NOT NULL) = (identity_source IN ('sso_cookie', 'app_attested'))
  ),
  CONSTRAINT api_requests_user_key_pair_check CHECK ((user_key IS NULL) = (user_email IS NULL)),
  CONSTRAINT api_requests_user_email_check CHECK (
    user_email IS NULL OR (user_email = lower(user_email) AND char_length(user_email) <= 254)
  ),
  CONSTRAINT api_requests_claimed_email_check CHECK (
    claimed_email IS NULL OR char_length(claimed_email) <= 254
  ),
  CONSTRAINT api_requests_user_key_check CHECK (user_key IS NULL OR octet_length(user_key) = 32),
  CONSTRAINT api_requests_ip_hash_check CHECK (ip_hash IS NULL OR octet_length(ip_hash) = 32),
  -- IP_CLASS_VALUES
  CONSTRAINT api_requests_ip_class_check CHECK (
    ip_class IN ('public', 'private', 'loopback', 'unknown')
  ),
  CONSTRAINT api_requests_geo_country_check CHECK (
    geo_country IS NULL OR geo_country ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT api_requests_geo_region_check CHECK (
    geo_region IS NULL OR char_length(geo_region) <= 128
  ),
  CONSTRAINT api_requests_geo_city_check CHECK (geo_city IS NULL OR char_length(geo_city) <= 128),
  CONSTRAINT api_requests_geo_lat_check CHECK (geo_lat IS NULL OR geo_lat BETWEEN -90 AND 90),
  CONSTRAINT api_requests_geo_lon_check CHECK (geo_lon IS NULL OR geo_lon BETWEEN -180 AND 180),
  CONSTRAINT api_requests_ua_browser_check CHECK (
    ua_browser IS NULL OR char_length(ua_browser) <= 128
  ),
  CONSTRAINT api_requests_ua_os_check CHECK (ua_os IS NULL OR char_length(ua_os) <= 128),
  CONSTRAINT api_requests_ua_device_check CHECK (ua_device IS NULL OR char_length(ua_device) <= 32),
  CONSTRAINT api_requests_sdk_check CHECK (sdk IS NULL OR char_length(sdk) <= 100)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_api_requests_app_id_occurred_at
  ON traffic.api_requests (app_id, occurred_at DESC);

CREATE INDEX idx_api_requests_app_id_endpoint_id_occurred_at
  ON traffic.api_requests (app_id, endpoint_id, occurred_at DESC);

CREATE INDEX idx_api_requests_occurred_at_failed
  ON traffic.api_requests (occurred_at DESC)
  WHERE status_code >= 400;

CREATE INDEX idx_api_requests_user_key_occurred_at
  ON traffic.api_requests (user_key, occurred_at DESC)
  WHERE user_key IS NOT NULL;

CREATE INDEX idx_api_requests_app_id_session_id
  ON traffic.api_requests (app_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX idx_api_requests_request_id
  ON traffic.api_requests (request_id)
  WHERE request_id IS NOT NULL;
