-- intent: the browser SDK's remote config per app (ADR 0009): a monotonic version and the list of
--         capture modules an admin switched OFF (remote config can only disable). Served by
--         POST /v1/ingest/config, changed by PATCH /v1/apps/:slug/sdk-config, which is audited as
--         APP_SDK_CONFIG_UPDATE — so the audit action CHECK is swapped (same name) to allow it.

ALTER TABLE traffic.apps
  ADD COLUMN sdk_config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN sdk_disabled_modules text[] NOT NULL DEFAULT '{}',
  ADD COLUMN sdk_config_updated_at timestamptz NULL;

ALTER TABLE traffic.apps
  ADD CONSTRAINT apps_sdk_config_version_check CHECK (sdk_config_version >= 1),
  -- SDK_CAPTURE_MODULE_VALUES (packages/shared/src/constants/traffic.ts)
  ADD CONSTRAINT apps_sdk_disabled_modules_check CHECK (
    sdk_disabled_modules <@ ARRAY[
      'page_view', 'page_time', 'auto_tools', 'manual_tools', 'custom', 'header_propagation',
      'retry_queue'
    ]::text[]
  );

-- Mirrors AUDIT_ACTION_VALUES (packages/shared/src/constants/traffic.ts).
ALTER TABLE traffic.admin_audit_log
  DROP CONSTRAINT admin_audit_log_action_check,
  ADD CONSTRAINT admin_audit_log_action_check CHECK (
    action IN (
      'APP_CREATE', 'APP_UPDATE', 'APP_DISABLE', 'KEY_CREATE', 'KEY_EXPIRE', 'KEY_REVOKE',
      'APP_SDK_CONFIG_UPDATE'
    )
  );
