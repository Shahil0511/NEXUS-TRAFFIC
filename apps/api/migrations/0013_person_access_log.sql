-- intent: append-only trail of person-page opens: which admin opened which part of whose page,
--         and when. The person is stored as user_key plus a MASKED email (s***@libas.in, computed
--         by the API), never the full address. Triggers reject UPDATE, DELETE and TRUNCATE for
--         every role (the owner included); nexus_app is granted SELECT and INSERT only (grants.ts).

CREATE TABLE traffic.person_access_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  viewer_email text NOT NULL,
  subject_user_key bytea NOT NULL,
  subject_email_masked text NOT NULL,
  surface text NOT NULL,
  CONSTRAINT person_access_log_viewer_email_check CHECK (char_length(viewer_email) BETWEEN 1 AND 254),
  -- Same form as api_requests.user_key / web_events.user_key (HMAC-SHA256, 32 bytes).
  CONSTRAINT person_access_log_subject_user_key_check CHECK (octet_length(subject_user_key) = 32),
  -- A masked address only: one character, '***', then '@domain' (or '***' alone).
  CONSTRAINT person_access_log_subject_email_masked_check CHECK (
    char_length(subject_email_masked) BETWEEN 3 AND 260
    AND (subject_email_masked = '***' OR subject_email_masked ~ '^.\*\*\*@.+$')
  ),
  -- Mirrors PERSON_ACCESS_SURFACE_VALUES (packages/shared/src/constants/traffic.ts).
  CONSTRAINT person_access_log_surface_check CHECK (
    surface IN (
      'person_profile', 'person_timeline', 'person_devices', 'person_daily',
      'person_visits', 'person_failures'
    )
  )
);

CREATE INDEX idx_person_access_log_viewed_at
  ON traffic.person_access_log (viewed_at DESC, id DESC);
CREATE INDEX idx_person_access_log_subject_user_key_viewed_at
  ON traffic.person_access_log (subject_user_key, viewed_at DESC, id DESC);

-- ─── Append-only guard ───────────────────────────────────────────────────────

CREATE FUNCTION traffic.reject_person_access_log_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = traffic, pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'traffic.person_access_log is append-only (% refused)', TG_OP
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION traffic.reject_person_access_log_change() IS
  'Trigger: refuses UPDATE, DELETE and TRUNCATE on person_access_log (append-only).';

CREATE TRIGGER trg_person_access_log_no_update_delete
  BEFORE UPDATE OR DELETE ON traffic.person_access_log
  FOR EACH ROW EXECUTE FUNCTION traffic.reject_person_access_log_change();

CREATE TRIGGER trg_person_access_log_no_truncate
  BEFORE TRUNCATE ON traffic.person_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION traffic.reject_person_access_log_change();
