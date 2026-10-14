#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Data Nexus Traffic — automatic deploy, run ON the server by the self-hosted runner
# (.github/workflows/deploy.yml, ADR 0005). Not meant to be run by hand: use scripts/deploy.sh.
#
#   bash scripts/ci-deploy.sh <sha>        (from the deploy checkout, the folder holding .env)
#
# 1. fetches <sha> from GitHub with the job token (GIT_FETCH_TOKEN; the server needs no git login)
# 2. remembers the commit deployed now, then `git reset --hard <sha>` — ignored files (.env,
#    backups/) are untouched; uncommitted edits to TRACKED files on the server are discarded
# 3. re-runs the NEW version of this script, which runs `SKIP_PULL=1 bash scripts/deploy.sh`
#    (preflight → docker compose up -d --build → health through the edge). The build runs while the
#    old containers keep serving.
# 4. if that fails: `git reset --hard <previous>` and deploys the previous commit again (its image
#    layers are still cached, so it is quick), then exits 1 so the GitHub run shows red.
#    Migrations are additive, so the previous code runs fine on the newer schema.
#
# Everything sits in functions and the last line ends with `exit`: `git reset` rewrites this very file
# while it runs, and bash reads scripts lazily.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '\n\033[1m[ci-deploy %s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }

# GITHUB_REPOSITORY (owner/repo) is set by the runner; fall back to origin's URL.
repo_url() {
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    printf 'https://github.com/%s.git' "$GITHUB_REPOSITORY"
  else
    git remote get-url origin
  fi
}

# Fetch <sha> (on main). The token goes in through GIT_CONFIG_* env, never on the command line.
fetch_commit() {
  local target="$1" url
  url="$(repo_url)"
  if [ -n "${GIT_FETCH_TOKEN:-}" ]; then
    local n="${GIT_CONFIG_COUNT:-0}" header
    header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GIT_FETCH_TOKEN" | base64 | tr -d '\n')"
    (
      export GIT_CONFIG_COUNT=$((n + 1))
      export "GIT_CONFIG_KEY_${n}=http.https://github.com/.extraheader"
      export "GIT_CONFIG_VALUE_${n}=${header}"
      git fetch --no-tags "$url" main
    )
  else
    git fetch --no-tags "$url" main
  fi
  git cat-file -e "${target}^{commit}" || { log "commit ${target} not found after the fetch"; return 1; }
}

# Deploy the checked-out tree; on failure put <previous> back and deploy it.
deploy_or_roll_back() {
  local target="$1" previous="$2"
  log "deploying ${target:0:12}"
  if SKIP_PULL=1 bash scripts/deploy.sh; then
    log "deploy OK — ${target:0:12} is serving"
    return 0
  fi
  log "deploy of ${target:0:12} FAILED"
  if [ -z "$previous" ] || [ "$previous" = "$target" ]; then
    log 'no earlier commit to roll back to — check the server: docker compose ps / logs'
    return 1
  fi
  log "rolling back to ${previous:0:12}"
  git reset --hard "$previous"
  if SKIP_PULL=1 bash scripts/deploy.sh; then
    log "rollback OK — the PREVIOUS version ${previous:0:12} is serving"
  else
    log 'rollback FAILED too — check the server: docker compose ps / logs'
  fi
  return 1
}

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  export MSYS_NO_PATHCONV=1 # Git Bash on a Windows server: never rewrite /paths in docker args

  if [ "${1:-}" = '--deploy' ]; then
    deploy_or_roll_back "${2:?}" "${3:-}"
    return
  fi

  local target="${1:?usage: bash scripts/ci-deploy.sh <sha>}" previous=''
  [ -d .git ] || { log 'not a git checkout — automatic deploys need a git clone (DEPLOY.md)'; return 1; }
  log "fetching ${target:0:12}"
  fetch_commit "$target"
  previous="$(git rev-parse --verify -q HEAD || true)"
  git reset --hard "$target"
  # Continue in the version of this script that belongs to <sha>.
  exec bash scripts/ci-deploy.sh --deploy "$target" "$previous"
}

main "$@"; exit "$?"
