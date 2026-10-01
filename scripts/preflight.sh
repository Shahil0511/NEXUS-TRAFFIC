#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — preflight checks before the first (or any) deploy.
#
#   bash scripts/preflight.sh            (from the repo root, on the server)
#
# Checks: Docker Compose v2.20+ · .env exists · required keys are filled · secrets are hex ≥ 64
# chars (openssl rand -hex 32) and not placeholders · DB passwords match their URLs · host ports
# 3305/4005 are free (or already ours) · ≥ 5 GB free disk.
# Exit code 0 = ready; 1 = at least one FAIL (every problem is listed, not just the first).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
MIN_COMPOSE_VERSION="2.20.0"
MIN_FREE_GB=5
PORTS=(4005 3305) # api, web (host side, 127.0.0.1)
COMPOSE_PROJECT="nexus-traffic"

REQUIRED_KEYS=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  MIGRATION_DATABASE_URL NEXUS_APP_DB_PASSWORD DATABASE_URL
  LIBAS_JWT_SECRET API_KEY_PEPPER USER_KEY_SECRET IP_HASH_SECRET
)
HEX_SECRET_KEYS=(POSTGRES_PASSWORD NEXUS_APP_DB_PASSWORD API_KEY_PEPPER USER_KEY_SECRET IP_HASH_SECRET)
RECOMMENDED_KEYS=(DASHBOARD_ADMIN_EMAILS DOCS_CONTACT)

failures=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

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
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
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

check_required_keys() {
  local key value
  for key in "${REQUIRED_KEYS[@]}"; do
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
  local key value
  for key in "${HEX_SECRET_KEYS[@]}"; do
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

# DATABASE_URL must carry NEXUS_APP_DB_PASSWORD; MIGRATION_DATABASE_URL must carry the owner's.
check_url_passwords() {
  local app_pw owner_pw db_url mig_url
  app_pw="$(env_value NEXUS_APP_DB_PASSWORD)"
  owner_pw="$(env_value POSTGRES_PASSWORD)"
  db_url="$(env_value DATABASE_URL)"
  mig_url="$(env_value MIGRATION_DATABASE_URL)"
  if [ -n "$app_pw" ] && [[ "$db_url" != *":${app_pw}@"* ]]; then
    fail 'DATABASE_URL does not contain NEXUS_APP_DB_PASSWORD (postgres://nexus_app:<it>@postgres:5432/…)'
  fi
  if [ -n "$owner_pw" ] && [[ "$mig_url" != *":${owner_pw}@"* ]]; then
    fail 'MIGRATION_DATABASE_URL does not contain POSTGRES_PASSWORD'
  fi
  if [[ "$db_url" != *"@postgres:"* ]]; then
    warn 'DATABASE_URL host is not "postgres" (the compose service name)'
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
  local sockets ours port
  sockets="$(listening_sockets || true)"
  ours="$(docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" --format '{{.Ports}}' 2>/dev/null || true)"
  if [ -z "$sockets" ]; then
    warn 'neither ss nor netstat is available — cannot check ports'
    return
  fi
  for port in "${PORTS[@]}"; do
    if ! grep -Eq "[:.]${port}([^0-9]|$)" <<<"$sockets"; then
      pass "port ${port} is free"
    elif grep -q ":${port}->" <<<"$ours"; then
      pass "port ${port} is used by this stack (redeploy)"
    else
      fail "port ${port} is already in use by another process"
    fi
  done
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
  echo "Data Nexus Traffic preflight (${REPO_ROOT})"
  check_compose
  if check_env_file; then
    check_required_keys
    check_hex_secrets
    check_url_passwords
  fi
  check_ports
  check_disk
  echo
  if [ "$failures" -gt 0 ]; then
    echo "Preflight FAILED: ${failures} problem(s). Fix them and run again."
    exit 1
  fi
  echo 'Preflight OK — next: bash scripts/deploy.sh'
}

main "$@"
