#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — restore a pg-backup dump into BACKUP_DATABASE_URL (schema `traffic` only).
#
#   docker compose stop api web
#   docker compose exec pg-backup sh /ops/backup/restore.sh /backups/nexus-traffic-YYYY-MM-DD.dump
#   docker compose up -d
#
# WHY not `pg_restore --clean`: it cannot drop the partitions' inherited constraints and fails.
# Instead: rename the live schema to traffic_before_restore → pg_restore in ONE transaction →
# success: drop the old schema / failure: rename it back (the database is as it was).
# Touches only the schema `traffic` of that database — nothing else on the server.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

DUMP="${1:?usage: restore.sh /backups/nexus-traffic-YYYY-MM-DD.dump}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set (compose defaults it to MIGRATION_DATABASE_URL)}"
OLD_SCHEMA=traffic_before_restore

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pg-restore: $*"
}

sql() {
  psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"
}

[ -f "$DUMP" ] || { log "no such file: $DUMP"; exit 2; }
pg_restore --list "$DUMP" > /dev/null || { log "not a pg_dump custom-format file: $DUMP"; exit 2; }
if [ "$(sql "SELECT count(*) FROM pg_namespace WHERE nspname = '$OLD_SCHEMA'")" != "0" ]; then
  log "schema $OLD_SCHEMA exists (an earlier restore?) — inspect and drop it first"
  exit 2
fi

log "renaming schema traffic to $OLD_SCHEMA"
sql "ALTER SCHEMA traffic RENAME TO $OLD_SCHEMA"

log "restoring $DUMP (single transaction)"
if pg_restore -d "$BACKUP_DATABASE_URL" --no-owner --single-transaction --exit-on-error "$DUMP"; then
  sql "DROP SCHEMA $OLD_SCHEMA CASCADE"
  log "done — migrations recorded: $(sql 'SELECT count(*) FROM traffic.schema_migrations'); now: docker compose up -d"
else
  log "FAILED — putting the previous schema back"
  sql "ALTER SCHEMA $OLD_SCHEMA RENAME TO traffic"
  exit 1
fi
