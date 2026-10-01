/**
 * Graceful shutdown, in order: stop accepting connections → stop jobs → close DB pools.
 * A 10 s unref'd failsafe forces exit if something hangs (matches the house pattern).
 */
import type { Server } from 'node:http';

import type { Container } from '../container';
import type { JobHandle } from '../jobs/scheduler';

export interface ShutdownDeps {
  server: Server;
  jobs: JobHandle;
  container: Container;
  /** Extra closers registered later (e.g. Socket.io in S4). */
  closers?: Array<() => Promise<void>>;
}

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;
  return async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const { container, server, jobs } = deps;
    container.logger.info('shutting down', { signal });
    const failsafe = setTimeout(() => process.exit(1), 10_000);
    failsafe.unref();
    try {
      for (const close of deps.closers ?? []) await close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      jobs.stop();
      await Promise.all([container.pools.write.end(), container.pools.query.end()]);
      process.exit(0);
    } catch (err) {
      container.logger.error('shutdown failed', { err });
      process.exit(1);
    }
  };
}
