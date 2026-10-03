/**
 * Graceful shutdown, in order: closers (Socket.io: timers, sockets) → stop accepting connections →
 * stop jobs (waits for a run in flight) → close DB pools.
 * A 10 s unref'd failsafe forces exit if something hangs (matches the house pattern).
 */
import type { Server } from 'node:http';

import type { Container } from '../container';
import type { JobHandle } from '../jobs/scheduler';

export interface ShutdownDeps {
  server: Server;
  jobs: JobHandle;
  container: Pick<Container, 'logger' | 'pools'>;
  /** Run first, in order (server.ts registers the Socket.io realtime close). */
  closers?: Array<() => Promise<void>>;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

export const SHUTDOWN_FAILSAFE_MS = 10_000;

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  return async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const { container, server, jobs } = deps;
    container.logger.info('shutting down', { signal });
    const failsafe = setTimeout(() => exit(1), SHUTDOWN_FAILSAFE_MS);
    failsafe.unref();
    try {
      for (const close of deps.closers ?? []) await close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await jobs.stop();
      await Promise.all([container.pools.write.end(), container.pools.query.end()]);
      clearTimeout(failsafe);
      exit(0);
    } catch (err) {
      container.logger.error('shutdown failed', { err });
      clearTimeout(failsafe);
      exit(1);
    }
  };
}
