#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — nightly Postgres backup (compose service `pg-backup`).
#
# Runs forever: sleeps until 01:30 IST, writes /backups/nexus-traffic-<IST date>.dump (pg_dump custom
# format) of BACKUP_DATABASE_URL, keeps the newest 14 dumps, repeats. POSIX sh (busybox in
# postgres:18-alpine), no tzdata needed: IST is a fixed UTC+05:30 offset (India has no daylight saving).
#
# Target: BACKUP_DATABASE_URL (compose defaults it to MIGRATION_DATABASE_URL) — production: the
# nexus_traffic database on the external server 10.150.0.5 (ADR 0002); localdb: the postgres service.
# pg_dump must be >= the server's major version (18), hence the postgres:18-alpine image.
#
#   manual backup now:  docker compose exec pg-backup sh /ops/backup/run.sh --once
#   restore (DANGER: drops and recreates the dumped objects in that database; ./backups is mounted
#   at /backups in this container):
#     docker compose exec pg-backup sh -c \
#       'pg_restore -d "$BACKUP_DATABASE_URL" --clean --if-exists /backups/nexus-traffic-YYYY-MM-DD.dump'
#
# Env (from docker-compose.yml): BACKUP_DATABASE_URL (postgres://user:url-encoded-password@host:port/db).
# Optional: BACKUP_AT_IST (HH:MM, default 01:30), BACKUP_KEEP (default 14).
# The connection string is NEVER printed (it holds the password); logs show host:port/db only.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

BACKUP_DIR=/backups
BACKUP_AT_IST="${BACKUP_AT_IST:-01:30}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set (compose defaults it to MIGRATION_DATABASE_URL)}"
IST_OFFSET_SECONDS=19800 # +05:30
DAY_SECONDS=86400
IST_TZ='IST-5:30' # POSIX TZ string: works without /usr/share/zoneinfo

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup: $*"
}

# host:port/db of BACKUP_DATABASE_URL — never the user or the password.
describe_target() {
  rest="${BACKUP_DATABASE_URL#*://}"
  rest="${rest##*@}"
  echo "${rest%%\?*}"
}

# Seconds from now until the next BACKUP_AT_IST (0 < result <= 1 day).
seconds_until_next_run() {
  hours=$(echo "$BACKUP_AT_IST" | cut -d: -f1)
  minutes=$(echo "$BACKUP_AT_IST" | cut -d: -f2)
  target_ist=$(( ${hours#0} * 3600 + ${minutes#0} * 60 ))
  target_utc=$(( (target_ist - IST_OFFSET_SECONDS + DAY_SECONDS) % DAY_SECONDS ))
  now_utc=$(( $(date -u +%s) % DAY_SECONDS ))
  delay=$(( (target_utc - now_utc + DAY_SECONDS) % DAY_SECONDS ))
  [ "$delay" -eq 0 ] && delay=$DAY_SECONDS
  echo "$delay"
}

# One dump, written to a temp file first so a failed run never leaves a truncated .dump behind.
run_backup() {
  stamp=$(TZ="$IST_TZ" date +%Y-%m-%d)
  target="$BACKUP_DIR/nexus-traffic-$stamp.dump"
  tmp="$target.partial"
  log "dumping $(describe_target) to $target"
  if pg_dump "$BACKUP_DATABASE_URL" -Fc > "$tmp"; then
    mv -f "$tmp" "$target"
    log "done ($(du -h "$target" | cut -f1))"
  else
    rm -f "$tmp"
    log "FAILED — will retry at the next scheduled time"
    return 1
  fi
}

# Keep only the newest BACKUP_KEEP dumps.
prune_old_backups() {
  ls -1t "$BACKUP_DIR"/nexus-traffic-*.dump 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
    log "removing $old"
    rm -f "$old"
  done
}

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "--once" ]; then
  run_backup
  prune_old_backups
  exit 0
fi

# PID 1 ignores SIGTERM unless trapped; sleeping in the background lets `docker stop` end us at once.
trap 'log "stopping"; exit 0' TERM INT

log "scheduled daily at $BACKUP_AT_IST IST, keeping $BACKUP_KEEP dumps"
while true; do
  delay=$(seconds_until_next_run)
  log "next backup in ${delay}s"
  sleep "$delay" &
  wait $!
  run_backup || true
  prune_old_backups
done
