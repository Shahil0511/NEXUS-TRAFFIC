/**
 * Starts the two long-running servers under the supervisor and waits for their health routes.
 *
 * WHY separate from index.ts: each function is one decision — what command, which env, how long
 * to wait, and what "not available" means — so the orchestrator stays a readable list of steps.
 */
import fs from 'node:fs';
import path from 'node:path';

import { apiEnv, webEnv, withBaseEnv, type DevTopologyInput } from './child-env';
import type { DevEnvValues } from './env-file';
import { ok, warn } from './log';
import type { ProcessSupervisor } from './processes';
import { npmCommand, tsxCommand } from './run-command';
import { API_PORT, DEV_URLS, REPO_ROOT, WEB_PORT } from './topology';
import { isPortInUse, probeHttp, waitUntil } from './wait-for';

const API_DIR = path.join(REPO_ROOT, 'apps', 'api');
const WEB_PACKAGE_JSON = path.join(REPO_ROOT, 'apps', 'web', 'package.json');
const WEB_WORKSPACE = '@nexus/web';

/** tsx watch restarts on save; a crash at boot keeps the watcher alive, so we wait with a timeout. */
const API_HEALTH_TIMEOUT_MS = 120_000;
/** The first `next dev` compile of a route can take a while on Windows. */
const WEB_HEALTH_TIMEOUT_MS = 180_000;

// ─── API ─────────────────────────────────────────────────────────────────────

export function startApi(supervisor: ProcessSupervisor, values: DevEnvValues, topology: DevTopologyInput): void {
  supervisor.start('api', tsxCommand(['watch', '--conditions=@nexus/source', 'src/server.ts']), {
    cwd: API_DIR,
    env: withBaseEnv(apiEnv(values, topology)),
  });
}

/** True once /api/health answers 200. */
export async function waitForApi(supervisor: ProcessSupervisor): Promise<boolean> {
  const healthy = await waitUntil(async () => (await probeHttp(DEV_URLS.apiHealth)).ok, {
    timeoutMs: API_HEALTH_TIMEOUT_MS,
    shouldAbort: () => !supervisor.isRunning('api'),
  });
  if (healthy) ok('api', `healthy at ${DEV_URLS.apiHealth}`);
  return healthy;
}

// ─── Web ─────────────────────────────────────────────────────────────────────

/** Why the dashboard cannot be started, or null when it can (apps/web is built concurrently). */
export async function webUnavailableReason(): Promise<string | null> {
  let manifest: { scripts?: Record<string, string> };
  try {
    manifest = JSON.parse(fs.readFileSync(WEB_PACKAGE_JSON, 'utf8')) as typeof manifest;
  } catch {
    return 'apps/web is not there yet';
  }
  if (!manifest.scripts?.dev) return 'apps/web has no "dev" script yet';
  if (await isPortInUse(WEB_PORT)) return `port ${WEB_PORT} is already in use`;
  return null;
}

export function startWeb(supervisor: ProcessSupervisor, values: DevEnvValues, topology: DevTopologyInput): void {
  supervisor.start('web', npmCommand(['run', 'dev', '-w', WEB_WORKSPACE]), {
    cwd: REPO_ROOT,
    env: withBaseEnv(webEnv(values, topology)),
  });
}

/** True once /traffic/healthz answers 200; false when it exits early or times out. */
export async function waitForWeb(supervisor: ProcessSupervisor): Promise<boolean> {
  const healthy = await waitUntil(async () => (await probeHttp(DEV_URLS.webHealth, 15_000)).ok, {
    timeoutMs: WEB_HEALTH_TIMEOUT_MS,
    intervalMs: 2000,
    shouldAbort: () => !supervisor.isRunning('web'),
  });
  if (healthy) ok('web', `healthy at ${DEV_URLS.webHealth}`);
  else warn('web', 'dashboard not available yet — everything else keeps running (see the [web] logs)');
  return healthy;
}

/** Fails fast with a clear message when the api port is taken (two api instances would fight). */
export async function assertApiPortFree(): Promise<void> {
  if (await isPortInUse(API_PORT)) {
    throw new Error(
      `port ${API_PORT} is already in use — another api (a previous npm run dev, or npm run dev -w @nexus/api) is running. Stop it and try again.`,
    );
  }
}
