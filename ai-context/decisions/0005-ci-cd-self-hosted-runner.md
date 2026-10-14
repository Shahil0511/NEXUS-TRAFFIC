# ADR 0005 — CI/CD: push to `main` deploys to the server through a self-hosted runner

- **Status:** accepted (2026-10-08); implemented 2026-10-08 (see [PROGRESS.md](../PROGRESS.md)):
  `.github/workflows/deploy.yml`, `scripts/ci-deploy.sh`, `scripts/setup-runner.ps1`,
  `scripts/setup-runner.sh`, DEPLOY.md "Automatic deploys".
- **Context:** until now the Team Lead deployed by hand (`bash scripts/deploy.sh`, or a handoff zip,
  [ADR 0004](0004-one-host-port-edge-nginx.md)). EBO_SALES already deploys itself on every push to `main`:
  GitHub-hosted CI, then a job on a **self-hosted GitHub Actions runner installed on the server**, which
  connects out to github.com (the server is on the internal network; GitHub cannot reach in). The user
  wants Nexus Traffic deployed the same way, with no manual step on the server.
- **Decision:**
  1. One workflow, two jobs. `ci` (ubuntu-latest, every push and PR): `npm ci`, `npm run typecheck`,
     `npm test`, `npm run test:db` against a `postgres:18-alpine` service container, and the
     generated-file checks (`env:example --check`, `openapi:emit --check`, `docs:build`). `deploy`
     (push to `main` only, after `ci`): runs on `[self-hosted, nexus-traffic-prod]`, one at a time
     (`concurrency`, never cancelled).
  2. The deploy is `scripts/ci-deploy.sh <sha>` in the server's checkout (`DEPLOY_DIR`, written into
     the runner's `.env` by the setup script). It fetches the commit with the job's `GITHUB_TOKEN`
     (no git credentials on the server), `git reset --hard <sha>`, then runs the existing
     `scripts/deploy.sh` (`SKIP_PULL=1`). If that fails it resets to the previously deployed commit and
     deploys it again, then fails the run. One deploy implementation (bash) for both OSes: on a Windows
     server the workflow runs it with Git for Windows' `bin\bash.exe`.
  3. Its own runner, next to EBO_SALES' one: folder `C:\actions-runner-nexus-traffic` /
     `/opt/actions-runner-nexus-traffic`, label `nexus-traffic-prod`, name `<host>-nexus-traffic`.
     A repo-level runner serves one repo, and the two repos belong to different GitHub accounts.
     The setup scripts only ever replace the service of their own runner folder.
- **Consequences:**
  - The server must hold a **git clone** (not an unpacked handoff zip) with `.env` and `backups/` in it;
    both are git-ignored, so `git reset --hard` never touches them. Uncommitted edits to tracked files
    on the server are discarded by every deploy — never hand-edit the server checkout.
  - Pushing to `main` = deploying to production. The rule "push only after the user approved"
    ([06-process.md](../06-process.md)) now also means "deploy only after the user approved".
  - Rollback is by commit, not by image tag: the previous commit is rebuilt from the Docker layer cache.
    Safe because migrations are additive (an older api runs on a newer schema). A non-additive
    migration still needs a two-step release and its own ADR.
  - A change to `ci-deploy.sh` takes effect in the same deploy: after the reset it `exec`s the new
    version. Its `--deploy <sha> <previous>` interface must stay compatible.
  - EBO_SALES' own `scripts/setup-runner.ps1`, when re-run with a fresh token, deletes **every**
    `actions.runner.*` Windows service — including this one. After re-running it on a shared Windows
    server, re-run ours too (or fix EBO's script to only delete its own service).
