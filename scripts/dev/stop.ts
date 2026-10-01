/**
 * `npm run dev:stop` — stops a running `npm run dev` (if any) and the dev DB container.
 * The data volume is kept; `npm run dev` starts the same database again.
 */
import { assertDockerRunning, DockerNotRunningError, stopDevDb } from './docker-db';
import { fail, log, ok, warn } from './log';
import { findRunningLauncher, stopRunningLauncher } from './running-launcher';
import { DEV_DB } from './topology';

async function main(): Promise<number> {
  const launcherPort = await findRunningLauncher();
  if (launcherPort !== null) {
    log('dev', `stopping the running npm run dev (launcher on :${launcherPort}) …`);
    if (!(await stopRunningLauncher(launcherPort))) warn('dev', 'it did not stop within 20 s — press Ctrl+C in its terminal');
  }
  try {
    await assertDockerRunning();
  } catch (err) {
    if (err instanceof DockerNotRunningError) {
      warn('db', 'Docker is not running, so the dev DB is not running either.');
      return 0;
    }
    throw err;
  }
  const outcome = await stopDevDb();
  if (outcome === 'stopped') ok('db', `${DEV_DB.container} stopped (data kept in volume ${DEV_DB.volume})`);
  else if (outcome === 'already-stopped') log('db', `${DEV_DB.container} was already stopped`);
  else log('db', `${DEV_DB.container} does not exist — nothing to stop`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    fail('dev', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
