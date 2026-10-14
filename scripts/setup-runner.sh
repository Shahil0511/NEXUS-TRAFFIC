#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ONE-TIME setup for automatic deploys on a LINUX server (the Windows version is setup-runner.ps1).
# Same approach as EBO_SALES (ADR 0005). Run it from the server's git checkout of this repo (the
# folder holding .env and docker-compose.yml):
#
#   sudo bash scripts/setup-runner.sh <RUNNER_TOKEN>
#
# <RUNNER_TOKEN> comes from the GitHub repo admin of NEXUS-TRAFFIC: Settings → Actions → Runners →
# New self-hosted runner → copy the value after `--token` (valid for 1 hour). Not the EBO_SALES
# token: a runner belongs to one repo.
#
# What it does, so nobody has to do it by hand:
#   1. downloads the GitHub Actions runner into /opt/actions-runner-nexus-traffic (EBO_SALES' runner
#      keeps /opt/actions-runner; the two run side by side as separate services)
#   2. registers it to this repo with the label `nexus-traffic-prod` (what deploy.yml targets)
#   3. tells it where the checkout is (DEPLOY_DIR = this folder) — no GitHub variable needed
#   4. lets its user run docker, then installs + starts it as a systemd service (survives reboots)
#
# The runner runs as the user who OWNS this checkout, so it can update the files. It only makes
# outbound HTTPS connections to github.com; no inbound port is opened. Safe to re-run: this runner's
# registration is replaced (other runners are left alone).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TOKEN="${1:-}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner-nexus-traffic}"
LABEL="nexus-traffic-prod"

log() { printf '[setup-runner] %s\n' "$*"; }
die() { printf '[setup-runner] ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$TOKEN" ] || die "usage: sudo bash $0 <RUNNER_TOKEN>  (GitHub: Settings → Actions → Runners → New self-hosted runner)"
[ "$(id -u)" -eq 0 ] || die "run with sudo (it installs a systemd service)"
command -v docker >/dev/null || die "docker is not installed"
command -v curl >/dev/null || die "curl is not installed"
command -v git >/dev/null || die "git is not installed"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for f in docker-compose.yml scripts/deploy.sh scripts/ci-deploy.sh; do
  [ -f "$DEPLOY_DIR/$f" ] || die "run this from the repo checkout ($f missing in $DEPLOY_DIR)"
done
[ -d "$DEPLOY_DIR/.git" ] \
  || die "$DEPLOY_DIR is not a git checkout (an unpacked handoff zip?) — git clone the repo, copy .env and backups/ into it, run this from there (DEPLOY.md)"
[ -f "$DEPLOY_DIR/.env" ] || log "WARNING: $DEPLOY_DIR/.env is missing — deploys will fail until it exists (DEPLOY.md step 2)"

REPO_URL="$(git -c safe.directory='*' -C "$DEPLOY_DIR" remote get-url origin)"
REPO_URL="${REPO_URL%.git}"
REPO_URL="${REPO_URL/git@github.com:/https://github.com/}"
case "$REPO_URL" in https://github.com/*) ;; *) die "origin is not a GitHub repo: $REPO_URL" ;; esac

RUN_AS="$(stat -c %U "$DEPLOY_DIR")"
if [ "$RUN_AS" = "root" ]; then
  log "WARNING: the checkout is owned by root, so the runner will run as root"
  export RUNNER_ALLOW_RUNASROOT=1
fi
log "repo=$REPO_URL  deploy dir=$DEPLOY_DIR  runner user=$RUN_AS  runner dir=$RUNNER_DIR"

# 1. Download the latest runner (linux x64/arm64).
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac
VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
[ -n "$VERSION" ] || die "could not reach github.com to find the runner version (outbound HTTPS blocked?)"

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ -f .runner ]; then
  # Un-registering needs a separate "remove" token, so drop the local registration instead;
  # `--replace` below then takes over the old runner entry on GitHub by name. svc.sh only touches
  # the service of THIS runner folder.
  log "existing registration found — replacing it"
  ./svc.sh stop >/dev/null 2>&1 || true
  ./svc.sh uninstall >/dev/null 2>&1 || true
  rm -f .runner .credentials .credentials_rsaparams .service
fi
if [ ! -x ./config.sh ]; then
  log "downloading runner v$VERSION ($ARCH)"
  curl -fsSL "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$ARCH-$VERSION.tar.gz" \
    | tar xz
  ./bin/installdependencies.sh >/dev/null || log "WARNING: installdependencies.sh failed; continuing"
fi
chown -R "$RUN_AS" "$RUNNER_DIR"

# 2. Register it to the repo.
sudo -u "$RUN_AS" -E ./config.sh --unattended --replace \
  --url "$REPO_URL" --token "$TOKEN" \
  --name "$(hostname)-nexus-traffic" --labels "$LABEL" --work _work

# 3. Where to deploy: the runner exports its .env file to every job (deploy.yml reads DEPLOY_DIR).
grep -v '^DEPLOY_DIR=' .env 2>/dev/null > .env.tmp || true
echo "DEPLOY_DIR=$DEPLOY_DIR" >> .env.tmp
mv .env.tmp .env
chown "$RUN_AS" .env

# 4. Docker access, then the service (installed after the group change so it picks it up).
if [ "$RUN_AS" != "root" ]; then
  usermod -aG docker "$RUN_AS"
fi
./svc.sh install "$RUN_AS"
./svc.sh start

log "done. The runner should show as 'Idle' under GitHub → NEXUS-TRAFFIC → Settings → Actions → Runners."
log "From now on every push to main deploys here automatically (scripts/ci-deploy.sh)."
