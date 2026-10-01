/**
 * Finds a running `npm run dev` (via its launcher) and asks it to stop gracefully.
 *
 * WHY: dev:stop / dev:reset must not pull the database out from under a running api. The launcher
 * answers GET /ping and POST /actions/shutdown (with its action header), which stops api, web and
 * the launcher exactly like Ctrl+C would.
 */
import { LAUNCHER_ACTION_HEADER, LAUNCHER_ROUTES } from './launcher-page';
import { DEFAULT_LAUNCHER_PORT, LAUNCHER_PORT_ATTEMPTS, API_PORT } from './topology';
import { isPortInUse, waitUntil } from './wait-for';

const LAUNCHER_SERVICE = 'nexus-dev-launcher';

async function isLauncher(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${LAUNCHER_ROUTES.ping}`, { signal: AbortSignal.timeout(800) });
    const body = (await res.json()) as { service?: string };
    return body.service === LAUNCHER_SERVICE;
  } catch {
    return false;
  }
}

/** Port of a running launcher, or null. */
export async function findRunningLauncher(): Promise<number | null> {
  for (let port = DEFAULT_LAUNCHER_PORT; port < DEFAULT_LAUNCHER_PORT + LAUNCHER_PORT_ATTEMPTS; port += 1) {
    if ((await isPortInUse(port, 300)) && (await isLauncher(port))) return port;
  }
  return null;
}

/**
 * Asks the launcher on `port` to stop everything; resolves once the api port is free (or after 20 s).
 * Callers (dev:stop / dev:reset) stop the DB next, so the dev terminal must not claim it keeps running.
 */
export async function stopRunningLauncher(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}${LAUNCHER_ROUTES.shutdown}`, {
      method: 'POST',
      headers: { [LAUNCHER_ACTION_HEADER]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbStopping: true }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* the launcher may close the connection while stopping */
  }
  return waitUntil(async () => !(await isPortInUse(API_PORT)) && !(await isPortInUse(port)), {
    timeoutMs: 20_000,
    intervalMs: 500,
  });
}
