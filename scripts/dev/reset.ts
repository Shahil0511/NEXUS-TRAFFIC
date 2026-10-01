/**
 * `npm run dev:reset [-- --yes]` — deletes the dev database: stops a running `npm run dev`, removes
 * the container AND the `nexus-traffic-devdata` volume, and forgets the demo keys in `.env.dev`.
 *
 * WHY a prompt: this destroys every event you ingested locally. The dev secrets in `.env.dev` are
 * kept (delete the file yourself for brand-new secrets). The compose and test databases are never
 * touched.
 */
import { createInterface } from 'node:readline/promises';

import { parseDevArgs } from './cli-args';
import { assertDockerRunning, removeDevDbAndVolume } from './docker-db';
import { DEMO_KEYS, readDevEnvFile, updateDevEnvFile } from './env-file';
import { fail, log, ok, warn } from './log';
import { findRunningLauncher, stopRunningLauncher } from './running-launcher';
import { DEV_DB, DEV_ENV_FILE } from './topology';

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    warn('dev', 'no terminal to ask for confirmation — re-run with: npm run dev:reset -- --yes');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `This DELETES the dev database (container ${DEV_DB.container} + volume ${DEV_DB.volume}) and the demo keys in .env.dev.\nType "yes" to continue: `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const args = parseDevArgs(process.argv.slice(2));
  if (!args.yes && !(await confirm())) {
    log('dev', 'cancelled — nothing was deleted');
    return 1;
  }
  const launcherPort = await findRunningLauncher();
  if (launcherPort !== null) {
    log('dev', `stopping the running npm run dev (launcher on :${launcherPort}) …`);
    await stopRunningLauncher(launcherPort);
  }
  await assertDockerRunning();
  await removeDevDbAndVolume();
  ok('db', `removed container ${DEV_DB.container} and volume ${DEV_DB.volume}`);
  if (readDevEnvFile(DEV_ENV_FILE)) {
    updateDevEnvFile(DEV_ENV_FILE, Object.fromEntries(DEMO_KEYS.map((key) => [key, null])));
    ok('dev', 'removed the demo keys from .env.dev (dev secrets kept)');
  }
  log('dev', 'next npm run dev creates a fresh dev database');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    fail('dev', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
