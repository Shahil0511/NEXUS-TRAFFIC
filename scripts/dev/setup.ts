/**
 * `npm run dev:setup` — ONE-TIME local setup, then `npm run dev` every day (the EBO_SALES way).
 *
 *   1. .env.dev            dev-only random secrets (created once, reused)          env-file.ts
 *   2. dev DB              Docker container nexus-traffic-devdb on :55434          docker-db.ts
 *   3. builds              shared packages (next.config imports them) + guide      build.ts
 *   4. migrations          DB_APP_ROLE_MODE=separate (creates nexus_app)           migrate.ts
 *   5. apps/api/.env       every api + migrate key, dev values                      child-env.ts
 *      apps/web/.env.local every web key + DEV_USER_EMAIL (no login in next dev)
 *
 * Both env files are git-ignored and docker-ignored, and win over the root `.env` (compose):
 * the api loads apps/api/.env first (dotenv never overrides), `next dev` loads .env.local before
 * next.config.ts loads the root .env. Re-run any time; it rewrites both files.
 *
 * @see ../../ai-context/09-local-development.md
 */
import fs from 'node:fs';
import path from 'node:path';

import { buildSharedAndDocs } from './build';
import { apiEnv, devAdminEmails, migrateEnv, webEnv, type EnvMap } from './child-env';
import { assertDockerRunning, ensureDevDb, waitForDevDb } from './docker-db';
import { ensureDevEnvFile } from './env-file';
import { fail, log, ok } from './log';
import { runMigrations } from './migrate';
import { capture } from './run-command';
import { DEV_ENV_FILE, REPO_ROOT, WEB_ORIGIN } from './topology';

const DB_READY_TIMEOUT_MS = 90_000;
const API_ENV_FILE = path.join(REPO_ROOT, 'apps', 'api', '.env');
const WEB_ENV_FILE = path.join(REPO_ROOT, 'apps', 'web', '.env.local');

const HEADER = [
  '# LOCAL DEV ONLY — written by `npm run dev:setup` (scripts/dev/setup.ts). Git-ignored.',
  '# Random values for this laptop only: NEVER copy them to a server or into the root .env.',
];

function envFileText(values: EnvMap): string {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  return [...HEADER, ...lines, ''].join('\n');
}

async function gitEmail(): Promise<string | null> {
  const result = await capture('git', ['config', 'user.email'], { timeoutMs: 5000 });
  return result.code === 0 ? result.stdout.trim() || null : null;
}

async function main(): Promise<void> {
  const { values, created } = ensureDevEnvFile(DEV_ENV_FILE);
  log('dev', created ? 'created .env.dev (fresh dev secrets)' : 'reusing .env.dev');

  await assertDockerRunning();
  log('db', `dev DB: ${await ensureDevDb(values.DEV_DB_PASSWORD)}`);
  if (!(await waitForDevDb(DB_READY_TIMEOUT_MS))) throw new Error('dev DB did not become ready');

  const { sharedOk } = await buildSharedAndDocs();
  if (!sharedOk) throw new Error('building the shared packages failed');

  const migrateCode = await runMigrations(values);
  if (migrateCode !== 0) throw new Error(`migrations failed (exit ${migrateCode})`);

  const adminEmails = devAdminEmails(await gitEmail());
  const topology = { launcherOrigin: WEB_ORIGIN, adminEmails };
  fs.writeFileSync(API_ENV_FILE, envFileText({ ...migrateEnv(values), ...apiEnv(values, topology) }));
  fs.writeFileSync(
    WEB_ENV_FILE,
    envFileText({ ...webEnv(values, topology), DEV_USER_EMAIL: adminEmails[0] ?? '' }),
  );
  ok('dev', `wrote ${path.relative(REPO_ROOT, API_ENV_FILE)} and ${path.relative(REPO_ROOT, WEB_ENV_FILE)}`);
  ok('dev', `setup done — now: npm run dev  →  ${WEB_ORIGIN}/traffic (signed in as ${adminEmails[0]})`);
}

main().catch((err: unknown) => {
  fail('dev', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
