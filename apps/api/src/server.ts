/**
 * PROCESS ENTRY. Boot order:
 * config → container → schema must be current → partitions exist → listen → jobs → signal handlers.
 * The `migrate` compose service has already run; if the schema is behind, we refuse to start.
 */
import { createServer } from 'node:http';

import { createApp } from './app';
import { loadConfig } from './config';
import { createContainer } from './container';
import { startJobs } from './jobs/scheduler';
import { createShutdown } from './lifecycle/shutdown';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);
  const { logger } = container;

  await container.schemaGuard.assertCurrent(logger);
  await container.services.partitions.ensureAhead();

  const server = createServer(createApp(container));
  await new Promise<void>((resolve) => server.listen(config.env.PORT, resolve));
  logger.info('api listening', { port: config.env.PORT, nodeEnv: config.env.NODE_ENV });

  const jobs = startJobs(container);
  const shutdown = createShutdown({ server, jobs, container });
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // Config errors are already one readable line; print them plainly for `docker compose logs`.
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'boot failed', error: String(err) })}\n`);
  process.exit(1);
});
