/**
 * @nexus/node — the Data Nexus Traffic server SDK.
 *
 * WHY: one tested implementation of the server ingest contract (batching, limits, the retry table
 * of guide chapter 4) so every Node backend sends the same thing. Framework adapters such as
 * @nexus/express build events and hand them to this client.
 *
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
export { createNexusClient } from './client/nexus-client';
export { registerShutdownFlush, type ShutdownFlushOptions } from './shutdown';
export { createEventId } from './event-id';
export { resolveClientIp, buildIngestUrl, DEFAULT_NEXUS_URL, type IngestEndpoint } from './shared-helpers';
export { SDK_NAME, SDK_VERSION } from './version';
export type {
  NexusClient,
  NexusClientOptions,
  NexusClientStats,
  NexusFetch,
  NexusLogger,
  NexusServerBatch,
  NexusServerEvent,
} from './types';
