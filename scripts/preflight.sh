#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — preflight checks before the first (or any) deploy.
#
#   bash scripts/preflight.sh            production: the EXTERNAL database (10.150.0.5, ADR 0002)
#   bash scripts/preflight.sh --localdb  fully local stack (`--profile localdb`: postgres container)
#
# Checks: Docker Compose v2.20+ · .env exists · required keys are filled · DB_APP_ROLE_MODE is
# owner|separate · generated secrets are hex ≥ 64 chars (openssl rand -hex 32) and not placeholders ·
# owner mode: DATABASE_URL == MIGRATION_DATABASE_URL · separate mode: DATABASE_URL carries
# NEXUS_APP_DB_PASSWORD · --localdb: POSTGRES_* filled and MIGRATION_DATABASE_URL carries
# POSTGRES_PASSWORD · passwords inside URLs are URL-encoded (no raw @) · the database host:port from
# MIGRATION_DATABASE_URL answers on TCP (skipped for the compose service `postgres`) · the ONE host
# port NEXUS_PORT (default 8080, ADR 0004) is free (or already ours) · ≥ 5 GB free disk.
# Exit code 0 = ready; 1 = at least one FAIL (every problem is listed, not just the first).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
MIN_COMPOSE_VERSION="2.20.0"
MIN_FREE_GB=5
DEFAULT_NEXUS_PORT=8080 # the edge nginx — the only published port (docker-compose.yml)
COMPOSE_PROJECT="nexus-traffic"
DB_TCP_TIMEOUT_SECONDS=5
LOCAL_DB_HOST="postgres" # the compose service name of profile localdb

ALWAYS_REQUIRED_KEYS=(
  MIGRATION_DATABASE_URL DATABASE_URL
  LIBAS_JWT_SECRET API_KEY_PEPPER USER_KEY_SECRET IP_HASH_SECRET
)
LOCALDB_REQUIRED_KEYS=(POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB)
HEX_SECRET_KEYS=(API_KEY_PEPPER USER_KEY_SECRET IP_HASH_SECRET)
RECOMMENDED_KEYS=(DASHBOARD_ADMIN_EMAILS DOCS_CONTACT)

LOCALDB=0
APP_ROLE_MODE=separate # resolved from .env in resolve_mode (compose default: separate)

failures=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

usage() {
  echo 'usage: bash scripts/preflight.sh [--localdb]'
  echo '  --localdb  the .env is for the fully local stack (docker compose --profile localdb …)'
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --localdb) LOCALDB=1 ;;
      -h | --help) usage; exit 0 ;;
      *) echo "unknown argument: $arg"; usage; exit 1 ;;
    esac
  done
}

# "2.29.1" >= "2.20.0" ?
version_at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Value of KEY in .env (last occurrence wins, surrounding quotes removed). Never `source`d:
# .env values may contain characters bash would interpret.
env_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

# ─── Connection-string parsing (never prints the user or password) ───────────
# postgres://user:pw@host:port/db?x → "user:pw@host:port"
url_authority() {
  local rest="${1#*://}"
  rest="${rest%%/*}"
  printf '%s' "${rest%%\?*}"
}

# → "host:port" (port defaults to 5432; [ipv6] brackets removed)
url_host_port() {
  local authority host port
  authority="$(url_authority "$1")"
  authority="${authority##*@}"
  if [[ "$authority" == \[* ]]; then
    host="${authority#\[}"; host="${host%%\]*}"
    port="${authority##*\]}"; port="${port#:}"
  elif [[ "$authority" == *:* ]]; then
    host="${authority%%:*}"; port="${authority##*:}"
  else
    host="$authority"; port=''
  fi
  printf '%s %s' "$host" "${port:-5432}"
}

# ─── Docker / Compose ────────────────────────────────────────────────────────
check_compose() {
  echo 'Docker Compose'
  if ! command -v docker >/dev/null 2>&1; then
    fail 'docker is not installed or not on PATH'
    return
  fi
  local version
  if ! version="$(docker compose version --short 2>/dev/null)"; then
    if command -v docker-compose >/dev/null 2>&1; then
      fail 'only docker-compose v1 found — install the Compose v2 plugin (`docker compose`)'
    else
      fail '`docker compose` (v2 plugin) not found'
    fi
    return
  fi
  version="${version#v}"
  if version_at_least "$version" "$MIN_COMPOSE_VERSION"; then
    pass "docker compose ${version} (≥ ${MIN_COMPOSE_VERSION})"
  else
    fail "docker compose ${version} is older than ${MIN_COMPOSE_VERSION}"
  fi
}

# ─── .env ────────────────────────────────────────────────────────────────────
check_env_file() {
  echo '.env'
  if [ ! -f "$ENV_FILE" ]; then
    fail ".env not found — run: cp .env.example .env  and fill it in"
    return 1
  fi
  pass ".env exists"
}

# DB_APP_ROLE_MODE: owner (external server) | separate (localdb, compose default when empty).
resolve_mode() {
  local mode
  mode="$(env_value DB_APP_ROLE_MODE)"
  case "${mode:-separate}" in
    owner | separate)
      APP_ROLE_MODE="${mode:-separate}"
      pass "DB_APP_ROLE_MODE=${APP_ROLE_MODE}$([ -z "$mode" ] && echo ' (empty → compose default)')"
      ;;
    *)
      fail "DB_APP_ROLE_MODE must be owner or separate"
      ;;
  esac
  if [ "$LOCALDB" = 1 ]; then
    pass 'checking for the fully local stack (--localdb)'
  fi
}

check_required_keys() {
  local key value keys=("${ALWAYS_REQUIRED_KEYS[@]}")
  [ "$LOCALDB" = 1 ] && keys+=("${LOCALDB_REQUIRED_KEYS[@]}")
  [ "$APP_ROLE_MODE" = separate ] && keys+=(NEXUS_APP_DB_PASSWORD)
  for key in "${keys[@]}"; do
    value="$(env_value "$key")"
    if [ -z "$value" ]; then
      fail "$key is empty"
    elif [[ "$value" == *change-me* ]]; then
      fail "$key still holds the change-me placeholder"
    fi
  done
  for key in "${RECOMMENDED_KEYS[@]}"; do
    [ -n "$(env_value "$key")" ] || warn "$key is empty (recommended)"
  done
}

check_hex_secrets() {
  local key value keys=("${HEX_SECRET_KEYS[@]}")
  [ "$APP_ROLE_MODE" = separate ] && keys+=(NEXUS_APP_DB_PASSWORD)
  for key in "${keys[@]}"; do
    value="$(env_value "$key")"
    [ -z "$value" ] && continue
    if [[ "$value" =~ ^[0-9a-fA-F]{64,}$ ]]; then
      pass "$key is hex (${#value} chars)"
    else
      fail "$key must be ≥ 64 hex chars — generate with: openssl rand -hex 32"
    fi
  done
  local jwt
  jwt="$(env_value LIBAS_JWT_SECRET)"
  if [ -n "$jwt" ] && [ "${#jwt}" -lt 32 ]; then
    warn 'LIBAS_JWT_SECRET is shorter than 32 chars — is it the real portal secret?'
  fi
}

# A raw '@' (or '/') inside the password breaks the URL: it must be URL-encoded (@ → %40).
check_url_encoding() {
  local key value authority userinfo
  for key in MIGRATION_DATABASE_URL DATABASE_URL BACKUP_DATABASE_URL; do
    value="$(env_value "$key")"
    [ -z "$value" ] && continue
    if [[ "$value" != postgres://* && "$value" != postgresql://* ]]; then
      fail "$key must start with postgres:// (or postgresql://)"
      continue
    fi
    authority="$(url_authority "$value")"
    userinfo="${authority%@*}"
    if [[ "$authority" != *@* ]]; then
      fail "$key has no user@ part"
    elif [[ "$userinfo" == *@* ]]; then
      fail "$key: the password contains a raw '@' — URL-encode it as %40 (also : → %3A, / → %2F, # → %23)"
    fi
  done
}

# owner: the api uses the migrate login. separate: DATABASE_URL carries NEXUS_APP_DB_PASSWORD.
# --localdb: MIGRATION_DATABASE_URL carries POSTGRES_PASSWORD and targets the postgres service.
check_db_urls() {
  local app_pw owner_pw db_url mig_url mig_host
  db_url="$(env_value DATABASE_URL)"
  mig_url="$(env_value MIGRATION_DATABASE_URL)"
  read -r mig_host _ <<<"$(url_host_port "$mig_url")"

  if [ "$APP_ROLE_MODE" = owner ]; then
    if [ -n "$db_url" ] && [ "$db_url" = "$mig_url" ]; then
      pass 'owner mode: DATABASE_URL and MIGRATION_DATABASE_URL are identical'
    else
      fail 'owner mode: DATABASE_URL must be IDENTICAL to MIGRATION_DATABASE_URL (the api uses the migrate login)'
    fi
  else
    app_pw="$(env_value NEXUS_APP_DB_PASSWORD)"
    if [ -n "$app_pw" ] && [[ "$db_url" != *"://nexus_app:${app_pw}@"* ]]; then
      fail 'separate mode: DATABASE_URL must be postgres://nexus_app:<NEXUS_APP_DB_PASSWORD>@…'
    fi
    if [ -n "$db_url" ] && [ "$db_url" = "$mig_url" ]; then
      fail 'separate mode: DATABASE_URL must NOT be the owner login (use nexus_app, or set DB_APP_ROLE_MODE=owner)'
    fi
  fi

  if [ "$LOCALDB" = 1 ]; then
    owner_pw="$(env_value POSTGRES_PASSWORD)"
    if [ -n "$owner_pw" ] && [[ "$mig_url" != *":${owner_pw}@"* ]]; then
      fail 'MIGRATION_DATABASE_URL does not contain POSTGRES_PASSWORD (--localdb)'
    fi
    if [ "$mig_host" != "$LOCAL_DB_HOST" ]; then
      warn "--localdb, but MIGRATION_DATABASE_URL host is not \"${LOCAL_DB_HOST}\" (the compose service)"
    fi
  elif [ "$mig_host" = "$LOCAL_DB_HOST" ]; then
    fail "MIGRATION_DATABASE_URL points at the local \"${LOCAL_DB_HOST}\" service — run with --localdb (and --profile localdb), or point it at the external server"
  elif [ "$APP_ROLE_MODE" = separate ]; then
    # separate mode creates/alters the cluster-wide role nexus_app: the shared server's login cannot.
    warn 'external database in separate mode: migrate needs CREATEROLE there — the shared server (10.150.0.5) needs DB_APP_ROLE_MODE=owner'
  fi
}

# ─── Database reachability ───────────────────────────────────────────────────
# Plain TCP connect from this host to host:port of MIGRATION_DATABASE_URL (bash /dev/tcp).
check_db_reachable() {
  echo 'Database'
  local url host port
  url="$(env_value MIGRATION_DATABASE_URL)"
  if [ -z "$url" ] || [[ "$url" == *change-me* ]]; then
    warn 'MIGRATION_DATABASE_URL not filled — skipping the reachability check'
    return
  fi
  read -r host port <<<"$(url_host_port "$url")"
  if [ "$host" = "$LOCAL_DB_HOST" ]; then
    pass "database host is the local \"${LOCAL_DB_HOST}\" service (profile localdb) — compose waits for its healthcheck"
    return
  fi
  local probe=(bash -c 'exec 3<>"/dev/tcp/$0/$1"' "$host" "$port")
  if command -v timeout >/dev/null 2>&1; then
    probe=(timeout "$DB_TCP_TIMEOUT_SECONDS" "${probe[@]}")
  fi
  if "${probe[@]}" 2>/dev/null; then
    pass "database ${host}:${port} is reachable (TCP)"
  else
    fail "database ${host}:${port} is NOT reachable within ${DB_TCP_TIMEOUT_SECONDS}s (firewall / VPN / wrong host?)"
  fi
}

# ─── Ports ───────────────────────────────────────────────────────────────────
# Listening TCP sockets on the host, one per line (ss, else netstat).
listening_sockets() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null || netstat -an 2>/dev/null
  fi
}

check_ports() {
  echo 'Ports'
  local sockets ours port=''
  [ -f "$ENV_FILE" ] && port="$(env_value NEXUS_PORT)"
  port="${port:-$DEFAULT_NEXUS_PORT}"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    fail "NEXUS_PORT \"${port}\" is not a port number (1–65535)"
    return
  fi
  sockets="$(listening_sockets || true)"
  ours="$(docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" --format '{{.Ports}}' 2>/dev/null || true)"
  if [ -z "$sockets" ]; then
    warn 'neither ss nor netstat is available — cannot check ports'
    return
  fi
  if ! grep -Eq "[:.]${port}([^0-9]|$)" <<<"$sockets"; then
    pass "NEXUS_PORT ${port} is free"
  elif grep -q ":${port}->" <<<"$ours"; then
    pass "NEXUS_PORT ${port} is used by this stack (redeploy)"
  else
    fail "NEXUS_PORT ${port} is already in use by another process — pick another in .env"
  fi
}

# ─── Disk ────────────────────────────────────────────────────────────────────
check_disk() {
  echo 'Disk'
  local target free_kb free_gb
  target="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  [ -d "$target" ] || target="$REPO_ROOT"
  free_kb="$(df -Pk "$target" | awk 'NR==2 {print $4}')"
  free_gb=$((free_kb / 1024 / 1024))
  if [ "$free_gb" -ge "$MIN_FREE_GB" ]; then
    pass "${free_gb} GB free on ${target} (≥ ${MIN_FREE_GB} GB)"
  else
    fail "only ${free_gb} GB free on ${target} — need ≥ ${MIN_FREE_GB} GB"
  fi
}

main() {
  parse_args "$@"
  echo "Data Nexus Traffic preflight (${REPO_ROOT})"
  check_compose
  local env_ok=0
  if check_env_file; then
    env_ok=1
    resolve_mode
    check_required_keys
    check_hex_secrets
    check_url_encoding
    check_db_urls
  fi
  [ "$env_ok" = 1 ] && check_db_reachable
  check_ports
  check_disk
  echo
  if [ "$failures" -gt 0 ]; then
    echo "Preflight FAILED: ${failures} problem(s). Fix them and run again."
    exit 1
  fi
  if [ "$LOCALDB" = 1 ]; then
    echo 'Preflight OK — next: docker compose --profile localdb up -d --build'
  else
    echo 'Preflight OK — next: bash scripts/deploy.sh'
  fi
}

main "$@"
