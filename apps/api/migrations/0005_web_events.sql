-- intent: one row per browser event sent by an app's frontend tracker (POST /v1/ingest/browser):
--         page_view, page_time (visible-ms DELTA, summed per page_view_id), tool_use and custom.
--         Monthly range partitions on occurred_at (traffic.ensure_partitions, see 0001), NO
--         default partition. Idempotent on (occurred_at, event_id). Sessions are derived with
--         GROUP BY (app_id, session_id) — there is no sessions table in v1. Limits mirror
--         packages/shared/src/ingest/schemas.ts and constants/ingest.ts (INGEST_LIMITS).

CREATE TABLE traffic.web_events (
  -- ─── time + idempotency ────────────────────────────────────────────────────
  occurred_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  clock_skew_ms bigint NULL,
  -- ─── session ───────────────────────────────────────────────────────────────
  app_id uuid NOT NULL REFERENCES traffic.apps (id),
  session_id uuid NOT NULL,
  anonymous_id uuid NULL,
  seq integer NOT NULL,
  -- ─── page ──────────────────────────────────────────────────────────────────
  event_type text NOT NULL,
  path text NOT NULL,
  path_template text NOT NULL,
  referrer_path text NULL,
  referrer_host text NULL,
  nav text NULL,
  -- ─── page_time ─────────────────────────────────────────────────────────────
  page_view_id uuid NULL,
  visible_ms integer NULL,
  is_final boolean NULL,
  time_reason text NULL,
  -- ─── tool_use / custom ─────────────────────────────────────────────────────
  tool text NULL,
  action text NULL,
  label text NULL,
  value numeric NULL,
  name text NULL,
  props jsonb NULL,
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

  CONSTRAINT web_events_pkey PRIMARY KEY (occurred_at, event_id),
  CONSTRAINT web_events_seq_check CHECK (seq >= 0),
  -- BROWSER_EVENT_TYPE_VALUES
  CONSTRAINT web_events_event_type_check CHECK (
    event_type IN ('page_view', 'page_time', 'tool_use', 'custom')
  ),
  CONSTRAINT web_events_path_check CHECK (path ~ '^/' AND char_length(path) <= 512),
  CONSTRAINT web_events_path_template_check CHECK (
    path_template ~ '^/' AND char_length(path_template) <= 256
  ),
  CONSTRAINT web_events_referrer_path_check CHECK (
    referrer_path IS NULL OR (referrer_path ~ '^/' AND char_length(referrer_path) <= 512)
  ),
  CONSTRAINT web_events_referrer_host_check CHECK (
    referrer_host IS NULL OR char_length(referrer_host) <= 253
  ),
  -- NAV_TYPE_VALUES
  CONSTRAINT web_events_nav_check CHECK (nav IS NULL OR nav IN ('load', 'route')),
  CONSTRAINT web_events_visible_ms_check CHECK (
    visible_ms IS NULL OR visible_ms BETWEEN 0 AND 86400000
  ),
  -- PAGE_TIME_REASON_VALUES
  CONSTRAINT web_events_time_reason_check CHECK (
    time_reason IS NULL OR time_reason IN ('hidden', 'route', 'pagehide', 'idle')
  ),
  -- TOOL_NAME_PATTERN
  CONSTRAINT web_events_tool_check CHECK (tool IS NULL OR tool ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  -- TOOL_ACTION_VALUES
  CONSTRAINT web_events_action_check CHECK (
    action IS NULL OR action IN ('click', 'open', 'submit', 'export', 'toggle', 'search', 'other')
  ),
  CONSTRAINT web_events_label_check CHECK (label IS NULL OR char_length(label) <= 120),
  CONSTRAINT web_events_name_check CHECK (name IS NULL OR name ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  -- A flat object of scalar values, at most 2 KB.
  CONSTRAINT web_events_props_check CHECK (
    props IS NULL OR (
      jsonb_typeof(props) = 'object'
      AND pg_column_size(props) <= 2048
      AND NOT jsonb_path_exists(props, '$.* ? (@.type() == "object" || @.type() == "array")')
    )
  ),
  -- ─── per-type rules ────────────────────────────────────────────────────────
  CONSTRAINT web_events_page_time_fields_check CHECK (
    event_type <> 'page_time' OR (
      page_view_id IS NOT NULL AND visible_ms IS NOT NULL
      AND is_final IS NOT NULL AND time_reason IS NOT NULL
    )
  ),
  CONSTRAINT web_events_tool_use_fields_check CHECK (event_type <> 'tool_use' OR tool IS NOT NULL),
  CONSTRAINT web_events_custom_fields_check CHECK (event_type <> 'custom' OR name IS NOT NULL),
  -- ─── identity (same rules as api_requests) ─────────────────────────────────
  -- IDENTITY_SOURCE_VALUES
  CONSTRAINT web_events_identity_source_check CHECK (
    identity_source IN ('sso_cookie', 'app_attested', 'client_claimed', 'anonymous')
  ),
  -- IDENTIFIED_SOURCE_VALUES
  CONSTRAINT web_events_identified_email_check CHECK (
    (user_email IS NOT NULL) = (identity_source IN ('sso_cookie', 'app_attested'))
  ),
  CONSTRAINT web_events_user_key_pair_check CHECK ((user_key IS NULL) = (user_email IS NULL)),
  CONSTRAINT web_events_user_email_check CHECK (
    user_email IS NULL OR (user_email = lower(user_email) AND char_length(user_email) <= 254)
  ),
  CONSTRAINT web_events_claimed_email_check CHECK (
    claimed_email IS NULL OR char_length(claimed_email) <= 254
  ),
  CONSTRAINT web_events_user_key_check CHECK (user_key IS NULL OR octet_length(user_key) = 32),
  CONSTRAINT web_events_ip_hash_check CHECK (ip_hash IS NULL OR octet_length(ip_hash) = 32),
  -- IP_CLASS_VALUES
  CONSTRAINT web_events_ip_class_check CHECK (
    ip_class IN ('public', 'private', 'loopback', 'unknown')
  ),
  CONSTRAINT web_events_geo_country_check CHECK (geo_country IS NULL OR geo_country ~ '^[A-Z]{2}$'),
  CONSTRAINT web_events_geo_region_check CHECK (
    geo_region IS NULL OR char_length(geo_region) <= 128
  ),
  CONSTRAINT web_events_geo_city_check CHECK (geo_city IS NULL OR char_length(geo_city) <= 128),
  CONSTRAINT web_events_geo_lat_check CHECK (geo_lat IS NULL OR geo_lat BETWEEN -90 AND 90),
  CONSTRAINT web_events_geo_lon_check CHECK (geo_lon IS NULL OR geo_lon BETWEEN -180 AND 180),
  CONSTRAINT web_events_ua_browser_check CHECK (
    ua_browser IS NULL OR char_length(ua_browser) <= 128
  ),
  CONSTRAINT web_events_ua_os_check CHECK (ua_os IS NULL OR char_length(ua_os) <= 128),
  CONSTRAINT web_events_ua_device_check CHECK (ua_device IS NULL OR char_length(ua_device) <= 32),
  CONSTRAINT web_events_sdk_check CHECK (sdk IS NULL OR char_length(sdk) <= 100)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_web_events_app_id_session_id_seq
  ON traffic.web_events (app_id, session_id, seq);

CREATE INDEX idx_web_events_app_id_occurred_at
  ON traffic.web_events (app_id, occurred_at DESC);

CREATE INDEX idx_web_events_app_id_tool_occurred_at
  ON traffic.web_events (app_id, tool, occurred_at DESC)
  WHERE tool IS NOT NULL;

CREATE INDEX idx_web_events_page_view_id
  ON traffic.web_events (page_view_id)
  WHERE event_type = 'page_time';

CREATE INDEX idx_web_events_user_key_occurred_at
  ON traffic.web_events (user_key, occurred_at DESC)
  WHERE user_key IS NOT NULL;
