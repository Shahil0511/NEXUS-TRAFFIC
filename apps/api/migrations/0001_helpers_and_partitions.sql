-- intent: shared helpers — the updated_at trigger function and the three whitelisted
--         SECURITY DEFINER functions that create and drop the monthly partitions of
--         traffic.api_requests and traffic.web_events (the runtime role nexus_app has no DDL
--         rights of its own; it may only call these). Grants to nexus_app are in 0007_grants.sql.
--
-- Partition naming: <parent>_yYYYYmMM (e.g. api_requests_y2026m10), bounds are UTC month starts.
-- The tables referenced below are created in 0004/0005; plpgsql resolves names at call time.

-- ─── updated_at trigger ──────────────────────────────────────────────────────

CREATE FUNCTION traffic.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION traffic.set_updated_at() IS
  'BEFORE UPDATE trigger: stamps updated_at so application code never has to.';

-- ─── ensure_monthly_partition ────────────────────────────────────────────────

CREATE FUNCTION traffic.ensure_monthly_partition(p_parent text, p_month date) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = traffic, pg_catalog, pg_temp
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_name text;
  v_from text;
  v_to text;
BEGIN
  IF p_parent IS NULL OR p_parent NOT IN ('api_requests', 'web_events') THEN
    RAISE EXCEPTION 'ensure_monthly_partition: table "%" is not partition-managed', p_parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_month IS NULL THEN
    RAISE EXCEPTION 'ensure_monthly_partition: month must not be null'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_name := p_parent || '_y' || to_char(v_month, 'YYYY') || 'm' || to_char(v_month, 'MM');
  -- Explicit UTC literals: the bounds never depend on the session TimeZone.
  v_from := to_char(v_month, 'YYYY-MM-DD') || ' 00:00:00+00';
  v_to := to_char((v_month + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00';

  BEGIN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS traffic.%I PARTITION OF traffic.%I FOR VALUES FROM (%L) TO (%L)',
      v_name, p_parent, v_from, v_to
    );
  EXCEPTION
    -- Two callers racing on the same month: the loser's CREATE collides; the partition exists.
    WHEN duplicate_table OR unique_violation THEN
      NULL;
  END;

  RETURN v_name;
END;
$$;

COMMENT ON FUNCTION traffic.ensure_monthly_partition(text, date) IS
  'Creates <parent>_yYYYYmMM for the month of p_month if missing (whitelisted parents only). Race-safe.';

-- ─── ensure_partitions ───────────────────────────────────────────────────────

CREATE FUNCTION traffic.ensure_partitions(p_months_back int, p_months_ahead int)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = traffic, pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamp := now() AT TIME ZONE 'UTC';
  v_first date;
  v_last date;
  v_month date;
  v_parent text;
BEGIN
  IF p_months_back IS NULL OR p_months_back < 0 OR p_months_back > 24
     OR p_months_ahead IS NULL OR p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'ensure_partitions: months_back/months_ahead must be between 0 and 24'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_first := date_trunc('month', v_now - make_interval(months => p_months_back))::date;
  v_last := (date_trunc('month', v_now) + make_interval(months => p_months_ahead))::date;

  v_month := v_first;
  WHILE v_month <= v_last LOOP
    FOREACH v_parent IN ARRAY ARRAY['api_requests', 'web_events'] LOOP
      RETURN NEXT traffic.ensure_monthly_partition(v_parent, v_month);
    END LOOP;
    v_month := (v_month + interval '1 month')::date;
  END LOOP;
  RETURN;
END;
$$;

COMMENT ON FUNCTION traffic.ensure_partitions(int, int) IS
  'Ensures monthly partitions of api_requests and web_events from now-back to now+ahead months (UTC).';

-- ─── drop_expired_partitions ─────────────────────────────────────────────────

CREATE FUNCTION traffic.drop_expired_partitions(p_parent text, p_keep_months int)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = traffic, pg_catalog, pg_temp
AS $$
DECLARE
  v_cutoff date;
  v_child record;
BEGIN
  IF p_parent IS NULL OR p_parent NOT IN ('api_requests', 'web_events') THEN
    RAISE EXCEPTION 'drop_expired_partitions: table "%" is not partition-managed', p_parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_keep_months IS NULL OR p_keep_months < 1 THEN
    RAISE EXCEPTION 'drop_expired_partitions: keep_months must be >= 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Never wait behind long dashboard queries; the nightly job retries at its next tick (55P03).
  SET LOCAL lock_timeout = '2s';

  v_cutoff := (date_trunc('month', now() AT TIME ZONE 'UTC')
               - make_interval(months => p_keep_months))::date;

  FOR v_child IN
    SELECT child.relname AS name,
           make_date(
             substring(child.relname FROM '_y([0-9]{4})m[0-9]{2}$')::int,
             substring(child.relname FROM '_y[0-9]{4}m([0-9]{2})$')::int,
             1
           ) AS month
      FROM pg_catalog.pg_inherits inh
      JOIN pg_catalog.pg_class parent ON parent.oid = inh.inhparent
      JOIN pg_catalog.pg_class child ON child.oid = inh.inhrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = parent.relnamespace
     WHERE ns.nspname = 'traffic'
       AND parent.relname = p_parent
       AND child.relname ~ ('^' || p_parent || '_y[0-9]{4}m[0-9]{2}$')
     ORDER BY 2
  LOOP
    CONTINUE WHEN v_child.month >= v_cutoff;
    -- Plain DETACH (CONCURRENTLY is forbidden inside functions/transactions).
    EXECUTE format('ALTER TABLE traffic.%I DETACH PARTITION traffic.%I', p_parent, v_child.name);
    EXECUTE format('DROP TABLE traffic.%I', v_child.name);
    RETURN NEXT v_child.name;
  END LOOP;
  RETURN;
END;
$$;

COMMENT ON FUNCTION traffic.drop_expired_partitions(text, int) IS
  'Detaches and drops monthly partitions older than the current UTC month minus p_keep_months.';

REVOKE ALL ON FUNCTION traffic.ensure_monthly_partition(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION traffic.ensure_partitions(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION traffic.drop_expired_partitions(text, int) FROM PUBLIC;
