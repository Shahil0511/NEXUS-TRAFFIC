/**
 * @nexus/express — Data Nexus Traffic middleware for Express 4 and 5 (and NestJS via `app.use`).
 *
 * WHY: one tested middleware instead of every team hand-writing route templates, client-IP and
 * retry logic. The @nexus/node client is bundled in, so this package has NO runtime dependencies.
 *
 *   import { createNexusClient, nexusMiddleware, registerShutdownFlush } from '@nexus/express';
 *   const nexus = createNexusClient({ url: process.env.NEXUS_URL, key: process.env.NEXUS_SECRET_KEY });
 *   app.use(nexusMiddleware({ client: nexus, basePath: '/my-app', getUser: (req) => req.user?.email }));
 *   registerShutdownFlush(nexus);
 *
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import {
  createNexusClient as createNodeClient,
  type NexusClient,
  type NexusClientOptions,
} from '@nexus/node';

export { nexusMiddleware } from './middleware';
export { defaultSkip } from './skip';
export { defaultClassify, CLIENT_CLOSED_STATUS } from './build-event';
export { joinPath } from './path';
export type {
  NexusEventKind,
  NexusMiddleware,
  NexusMiddlewareOptions,
  NexusRequestLike,
  NexusResponseLike,
} from './types';
export {
  buildIngestUrl,
  createEventId,
  registerShutdownFlush,
  resolveClientIp,
  DEFAULT_NEXUS_URL,
} from '@nexus/node';
export type {
  IngestEndpoint,
  NexusClient,
  NexusClientOptions,
  NexusClientStats,
  NexusFetch,
  NexusLogger,
  NexusServerBatch,
  NexusServerEvent,
  ShutdownFlushOptions,
} from '@nexus/node';

/** WHY: the SDK identity this adapter reports in `X-Nexus-SDK`. */
export const EXPRESS_SDK = { name: '@nexus/express', version: '1.0.0' } as const;

/**
 * createNexusClient from @nexus/node, reporting `@nexus/express@1.0.0` as the SDK.
 * Same options; returns a no-op client when url or key is missing. NEVER throws.
 */
export function createNexusClient(options: NexusClientOptions = {}): NexusClient {
  return createNodeClient({ sdk: { ...EXPRESS_SDK }, ...options });
}
