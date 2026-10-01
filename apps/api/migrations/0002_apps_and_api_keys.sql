-- intent: the registered apps (one row per integrating app, public id = slug) and their API keys
--         (secret keys for backends, publishable keys for browsers). Keys are stored as
--         HMAC-SHA256(API_KEY_PEPPER, key) — never in clear, except publishable keys which ship
--         in browser bundles anyway. Lookup is by the 14-char key_prefix.

-- ─── apps ────────────────────────────────────────────────────────────────────

CREATE TABLE traffic.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  base_path text NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  browser_ingest_enabled boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_slug_key UNIQUE (slug),
  -- Mirrors APP_SLUG_PATTERN (packages/shared/src/constants/ingest.ts).
  CONSTRAINT apps_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT apps_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 100),
  -- Mirrors basePathSchema (packages/shared/src/schemas/apps.ts).
  CONSTRAINT apps_base_path_check CHECK (
    base_path IS NULL
    OR (base_path ~ '^/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$' AND char_length(base_path) <= 100)
  ),
  CONSTRAINT apps_allowed_origins_check CHECK (cardinality(allowed_origins) <= 20),
  CONSTRAINT apps_created_by_check CHECK (char_length(created_by) BETWEEN 1 AND 254)
);

CREATE TRIGGER trg_apps_set_updated_at
  BEFORE UPDATE ON traffic.apps
  FOR EACH ROW EXECUTE FUNCTION traffic.set_updated_at();

-- ─── api_keys ────────────────────────────────────────────────────────────────

CREATE TABLE traffic.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES traffic.apps (id) ON DELETE RESTRICT,
  kind text NOT NULL,
  key_prefix text NOT NULL,
  key_hash bytea NOT NULL,
  public_key text NULL,
  label text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  last_used_at timestamptz NULL,
  last_sdk text NULL,
  exposed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by text NULL,
  CONSTRAINT api_keys_key_prefix_key UNIQUE (key_prefix),
  -- Mirrors KEY_KIND_VALUES (packages/shared/src/constants/keys.ts).
  CONSTRAINT api_keys_kind_check CHECK (kind IN ('secret', 'publishable')),
  -- KEY_PREFIXES + 8 random base62 chars = KEY_LOOKUP_PREFIX_LENGTH (14).
  CONSTRAINT api_keys_key_prefix_check CHECK (key_prefix ~ '^nx_(sk|pk)_[0-9A-Za-z]{8}$'),
  CONSTRAINT api_keys_prefix_matches_kind_check CHECK (
    left(key_prefix, 6) = CASE kind WHEN 'secret' THEN 'nx_sk_' WHEN 'publishable' THEN 'nx_pk_' END
  ),
  -- HMAC-SHA256 digest (bytea has no length modifier, hence the CHECK).
  CONSTRAINT api_keys_key_hash_check CHECK (octet_length(key_hash) = 32),
  -- Only publishable keys are kept in clear (and must be a full, matching publishable key).
  CONSTRAINT api_keys_public_key_check CHECK ((public_key IS NULL) = (kind = 'secret')),
  CONSTRAINT api_keys_public_key_format_check CHECK (
    public_key IS NULL
    OR (public_key ~ '^nx_pk_[0-9A-Za-z]{32}$' AND left(public_key, 14) = key_prefix)
  ),
  CONSTRAINT api_keys_label_check CHECK (char_length(label) BETWEEN 1 AND 100),
  CONSTRAINT api_keys_created_by_check CHECK (char_length(created_by) BETWEEN 1 AND 254),
  CONSTRAINT api_keys_last_sdk_check CHECK (last_sdk IS NULL OR char_length(last_sdk) <= 100),
  CONSTRAINT api_keys_revocation_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT api_keys_revoked_by_check CHECK (revoked_by IS NULL OR char_length(revoked_by) <= 254)
);

CREATE INDEX idx_api_keys_app_id ON traffic.api_keys (app_id);
