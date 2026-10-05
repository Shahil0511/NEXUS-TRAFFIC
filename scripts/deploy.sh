#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — deploy / update on the server (Team Lead).
#
#   bash scripts/deploy.sh               (from anywhere; runs in the repo root)
#   SKIP_PULL=1 bash scripts/deploy.sh   (deploy what is on disk, e.g. a rollback:
#                                         git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh)
#
# Works from a git checkout AND from an unpacked handoff zip (no .git: the pull is skipped).
# Steps: preflight → [git pull --ff-only] → docker compose up -d --build --remove-orphans
#        (migrate runs first; api starts only if it succeeded) → wait for health → smoke checks.
# Health goes through the ONE published port (edge nginx, NEXUS_PORT in .env — ADR 0004).
# Migrations are additive, so rolling back the code is safe.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEFAULT_NEXUS_PORT=8080
WAIT_SECONDS=180

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# NEXUS_PORT from .env (quotes and CR removed), else the compose default.
nexus_port() {
  local line
  line="$(grep -E '^NEXUS_PORT=' .env 2>/dev/null | tail -n1 || true)"
  line="${line#*=}"; line="${line%$'\r'}"; line="${line//\"/}"; line="${line//\'/}"
  printf '%s' "${line:-$DEFAULT_NEXUS_PORT}"
}

# Poll a URL until it answers 2xx or the timeout passes.
wait_for() {
  local url="$1" deadline=$((SECONDS + WAIT_SECONDS))
  until curl -fsS -o /dev/null "$url"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "timed out after ${WAIT_SECONDS}s waiting for ${url}"
      return 1
    fi
    sleep 3
  done
  echo "ok  ${url}"
}

BASE_URL="http://127.0.0.1:$(nexus_port)/traffic"

step 'Preflight'
bash scripts/preflight.sh

if [ -d .git ]; then
  if [ "${SKIP_PULL:-0}" != '1' ]; then
    step 'git pull --ff-only'
    git pull --ff-only
  fi
  echo "deploying $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
else
  echo 'deploying the files on disk (no .git — handoff zip; nothing to pull)'
fi

step 'docker compose up -d --build --remove-orphans'
docker compose up -d --build --remove-orphans

step 'Migration result'
docker compose ps -a migrate
if [ "$(docker compose ps -a --format '{{.ExitCode}}' migrate | tail -n1)" != '0' ]; then
  echo 'migrate did not exit 0 — the api was NOT replaced. Logs:'
  docker compose logs --tail 50 migrate
  exit 1
fi

step "Health (through the edge on ${BASE_URL})"
wait_for "${BASE_URL}/api/health/ready"
curl -fsS -o /dev/null "${BASE_URL}/api/docs/" && echo "ok  ${BASE_URL}/api/docs/"
wait_for "${BASE_URL}/healthz"

step 'Status'
docker compose ps

echo
echo 'Deployed. Public checks: https://nexus.libas.in/traffic/api/health and /traffic/api/docs/'
