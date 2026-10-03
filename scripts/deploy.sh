#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — deploy / update on the server (Team Lead).
#
#   bash scripts/deploy.sh               (from anywhere; runs in the repo root)
#   SKIP_PULL=1 bash scripts/deploy.sh   (deploy the checked-out commit, e.g. a rollback:
#                                         git checkout <sha> && SKIP_PULL=1 bash scripts/deploy.sh)
#
# Steps: preflight → git pull --ff-only → docker compose up -d --build --remove-orphans
#        (migrate runs first; api starts only if it succeeded) → wait for health → smoke checks.
# Migrations are additive, so rolling back the code is safe.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

API_READY_URL='http://127.0.0.1:4005/api/health/ready'
API_DOCS_URL='http://127.0.0.1:4005/api/docs/'
WEB_HEALTH_URL='http://127.0.0.1:3305/traffic/healthz'
WAIT_SECONDS=180

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

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

step 'Preflight'
bash scripts/preflight.sh

if [ "${SKIP_PULL:-0}" != '1' ]; then
  step 'git pull --ff-only'
  git pull --ff-only
fi
echo "deploying $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

step 'docker compose up -d --build --remove-orphans'
docker compose up -d --build --remove-orphans

step 'Migration result'
docker compose ps -a migrate
if [ "$(docker compose ps -a --format '{{.ExitCode}}' migrate | tail -n1)" != '0' ]; then
  echo 'migrate did not exit 0 — the api was NOT replaced. Logs:'
  docker compose logs --tail 50 migrate
  exit 1
fi

step 'Health'
wait_for "$API_READY_URL"
curl -fsS -o /dev/null "$API_DOCS_URL" && echo "ok  ${API_DOCS_URL}"
wait_for "$WEB_HEALTH_URL"

step 'Status'
docker compose ps

echo
echo 'Deployed. Public checks: https://nexus.libas.in/traffic/api/health and /traffic/api/docs/'
