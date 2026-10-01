/**
 * The dedicated dev Postgres container `nexus-traffic-devdb` (postgres:18-alpine, 127.0.0.1:55434).
 *
 * WHY ITS OWN CONTAINER: the compose stack (docker rehearsal) and the test containers
 * (nexus-traffic-testdb :55432, nexus-traffic-testdb18 :55433) must stay untouched while you
 * develop. This container is created once, started when stopped, reused when running, and only
 * removed by `npm run dev:reset`. It NEVER talks to the production server (ADR 0002).
 */
import { log } from './log';
import { capture } from './run-command';
import { DEV_DB } from './topology';
import { sleep, waitUntil } from './wait-for';

export class DockerNotRunningError extends Error {
  constructor(detail: string) {
    super(`Docker is not available (${detail}). Start Docker Desktop, then run npm run dev again.`);
  }
}

export type ContainerState = 'missing' | 'running' | 'stopped';

/** `docker info` succeeds only when the CLI exists AND the daemon answers. */
export async function assertDockerRunning(): Promise<void> {
  const result = await capture('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20_000 });
  if (result.code === -1) throw new DockerNotRunningError('the docker command was not found or timed out');
  if (result.code !== 0) throw new DockerNotRunningError('the Docker engine is not running');
}

/** Current state of the dev DB container. */
export async function devDbState(): Promise<ContainerState> {
  const result = await capture('docker', ['inspect', '--format', '{{.State.Status}}', DEV_DB.container], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) return 'missing';
  return result.stdout === 'running' ? 'running' : 'stopped';
}

export async function devVolumeExists(): Promise<boolean> {
  const result = await capture('docker', ['volume', 'inspect', DEV_DB.volume], { timeoutMs: 10_000 });
  return result.code === 0;
}

async function dockerOrThrow(args: string[], what: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const result = await capture('docker', args, { env, timeoutMs: 180_000 });
  if (result.code !== 0) throw new Error(`${what} failed: ${result.stderr || result.stdout}`);
}

/**
 * The password goes in through the docker CLI's OWN environment (`-e POSTGRES_PASSWORD` without a
 * value), so it never appears on a command line or in the console.
 */
async function createDevDb(password: string): Promise<void> {
  log('db', `creating container ${DEV_DB.container} (${DEV_DB.image}, volume ${DEV_DB.volume}) …`);
  await dockerOrThrow(
    [
      'run',
      '--detach',
      '--name',
      DEV_DB.container,
      '--label',
      'nexus-traffic.role=dev-db',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      `POSTGRES_USER=${DEV_DB.superuser}`,
      '--env',
      `POSTGRES_DB=${DEV_DB.database}`,
      '--publish',
      `${DEV_DB.host}:${DEV_DB.hostPort}:5432`,
      '--volume',
      `${DEV_DB.volume}:${DEV_DB.dataMount}`,
      DEV_DB.image,
    ],
    'docker run',
    { ...process.env, POSTGRES_PASSWORD: password },
  );
}

export type EnsureOutcome = 'created' | 'started' | 'reused';

/** Create if missing, start if stopped, reuse if running. */
export async function ensureDevDb(password: string): Promise<EnsureOutcome> {
  const state = await devDbState();
  if (state === 'running') return 'reused';
  if (state === 'stopped') {
    log('db', `starting existing container ${DEV_DB.container} …`);
    await dockerOrThrow(['start', DEV_DB.container], 'docker start');
    return 'started';
  }
  await createDevDb(password);
  return 'created';
}

/** pg_isready over TCP inside the container (the init-time server listens on the socket only). */
async function pgIsReady(): Promise<boolean> {
  const result = await capture(
    'docker',
    ['exec', DEV_DB.container, 'pg_isready', '-h', '127.0.0.1', '-U', DEV_DB.superuser, '-d', DEV_DB.database],
    { timeoutMs: 10_000 },
  );
  return result.code === 0;
}

/** Waits until Postgres accepts TCP connections; false on timeout. */
export async function waitForDevDb(timeoutMs: number): Promise<boolean> {
  const ready = await waitUntil(pgIsReady, { timeoutMs, intervalMs: 1000 });
  // A brand-new cluster restarts once after initdb; give the final server a moment.
  if (ready) await sleep(300);
  return ready && pgIsReady();
}

export async function stopDevDb(): Promise<'stopped' | 'already-stopped' | 'missing'> {
  const state = await devDbState();
  if (state === 'missing') return 'missing';
  if (state === 'stopped') return 'already-stopped';
  await dockerOrThrow(['stop', DEV_DB.container], 'docker stop');
  return 'stopped';
}

/** Removes the container AND its data volume (dev:reset only). */
export async function removeDevDbAndVolume(): Promise<void> {
  if ((await devDbState()) !== 'missing') await dockerOrThrow(['rm', '--force', DEV_DB.container], 'docker rm');
  if (await devVolumeExists()) await dockerOrThrow(['volume', 'rm', DEV_DB.volume], 'docker volume rm');
}
