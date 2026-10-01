-- intent: privileges of the runtime role nexus_app (created by the migrate bootstrap, see
--         apps/api/src/db/migration-runner/bootstrap.ts). DML only — NO DDL, no TRUNCATE, and
--         admin_audit_log is append-only. Partition DDL happens only through the whitelisted
--         SECURITY DEFINER functions of 0001. Default privileges cover tables the owner creates
--         later, including monthly partitions created by traffic.ensure_monthly_partition.

GRANT USAGE ON SCHEMA traffic TO nexus_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON traffic.apps, traffic.api_keys, traffic.api_requests, traffic.web_events,
     traffic.ingest_counters
  TO nexus_app;

GRANT SELECT, INSERT ON traffic.admin_audit_log TO nexus_app;

GRANT SELECT ON traffic.schema_migrations TO nexus_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA traffic TO nexus_app;

GRANT EXECUTE ON FUNCTION traffic.ensure_monthly_partition(text, date) TO nexus_app;
GRANT EXECUTE ON FUNCTION traffic.ensure_partitions(int, int) TO nexus_app;
GRANT EXECUTE ON FUNCTION traffic.drop_expired_partitions(text, int) TO nexus_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA traffic
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA traffic
  GRANT USAGE, SELECT ON SEQUENCES TO nexus_app;
