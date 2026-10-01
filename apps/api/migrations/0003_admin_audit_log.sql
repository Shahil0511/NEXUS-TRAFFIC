-- intent: append-only trail of admin actions on apps and API keys (who did what, when).
--         nexus_app may only SELECT and INSERT here (0007_grants.sql) — never UPDATE or DELETE.

CREATE TABLE traffic.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NULL,
  CONSTRAINT admin_audit_log_actor_email_check CHECK (char_length(actor_email) BETWEEN 1 AND 254),
  -- Mirrors AUDIT_ACTION_VALUES (packages/shared/src/constants/traffic.ts).
  CONSTRAINT admin_audit_log_action_check CHECK (
    action IN ('APP_CREATE', 'APP_UPDATE', 'APP_DISABLE', 'KEY_CREATE', 'KEY_EXPIRE', 'KEY_REVOKE')
  ),
  CONSTRAINT admin_audit_log_target_type_check CHECK (target_type IN ('app', 'api_key')),
  CONSTRAINT admin_audit_log_target_id_check CHECK (char_length(target_id) BETWEEN 1 AND 128),
  CONSTRAINT admin_audit_log_details_check CHECK (
    details IS NULL OR (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 4096)
  )
);

CREATE INDEX idx_admin_audit_log_created_at ON traffic.admin_audit_log (created_at DESC);
