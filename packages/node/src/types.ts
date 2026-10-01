/**
 * Public types of @nexus/node.
 *
 * WHY: declared here (not inferred from the zod schemas in @nexus/shared) so the published .d.ts
 * is self-contained and zod-free. `snippets.contract.test.ts` proves these shapes validate against
 * `serverIngestBatchSchema`, so they cannot drift from the contract.
 */

/** One element of `events[]` — guide chapter 2 (docs/integration/02-server-contract.md). */
export interface NexusServerEvent {
  /** Generated ONCE at capture (createEventId) and reused on retries — the idempotency key. */
  eventId: string;
  kind?: 'http' | 'stream';
  /** Request START time, ISO-8601. */
  occurredAt: string;
  method: string;
  /** Absolute path INCLUDING the public base path, WITHOUT the query string. */
  path: string;
  routeTemplate?: string;
  status: number;
  durationMs: number;
  ip?: string;
  userEmail?: string;
  requestId?: string;
  userAgent?: string;
  requestBytes?: number;
  responseBytes?: number;
  errorCode?: string;
  release?: string;
  sessionId?: string;
  pageViewId?: string;
}

/** The batch body POSTed to ROUTES.ingest.server. */
export interface NexusServerBatch {
  sentAt: string;
  sdk: { name: string; version: string };
  events: NexusServerEvent[];
}

/** Where the SDK writes its few diagnostics. NEVER receives keys or full emails. */
export interface NexusLogger {
  warn(message: string): void;
  error?(message: string): void;
}

/** A WHATWG-compatible fetch (global fetch on Node >= 18; injectable for tests). */
export type NexusFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface NexusClientOptions {
  /** NEXUS_URL WITHOUT `/api`, e.g. https://nexus.libas.in/traffic. Unset → a no-op client. */
  url?: string | null;
  /** NEXUS_SECRET_KEY (`nx_sk_…`). Server env ONLY. Unset → a no-op client. */
  key?: string | null;
  /** Proxies YOU run in front of the app (gateway → app = 1). Read by adapters; default 1. */
  trustProxyHops?: number;
  /** Queue bound; when full the OLDEST event is dropped (counted in stats().dropped). */
  maxQueue?: number;
  /** Flush as soon as this many events are queued. */
  flushEvents?: number;
  /** Flush at least this often (an unref'd timer: never keeps the process alive). */
  flushIntervalMs?: number;
  /** Per-request timeout. */
  requestTimeoutMs?: number;
  fetch?: NexusFetch;
  logger?: NexusLogger;
  /** Force the no-op client (e.g. in tests or local dev). */
  disabled?: boolean;
  /** Overrides the SDK identity — set by adapters such as @nexus/express. */
  sdk?: { name: string; version: string };
}

/** Delivery counters — cheap to read, meant for a health endpoint or a debug log. */
export interface NexusClientStats {
  /** Events waiting in memory. */
  queued: number;
  /** Events stored by the server (202 `accepted`). */
  accepted: number;
  /** Events the server already had (202 `duplicates`). */
  duplicates: number;
  /** Events refused per event inside a 202 (`rejected[]`) — fix the sender. */
  rejected: number;
  /** Events lost: queue overflow, refused batches, oversize events or retries exhausted. */
  dropped: number;
  /** HTTP attempts made (retries included). */
  attempts: number;
  /** True while sending is paused (401/403 or an intercepting proxy). */
  paused: boolean;
  /** False for the no-op client (no url/key, or disabled). */
  enabled: boolean;
}

export interface NexusClient {
  /** Queue one event. NEVER throws, NEVER blocks. */
  track(event: NexusServerEvent): void;
  /** Send everything queued now. Resolves when done; NEVER rejects. */
  flush(): Promise<void>;
  stats(): NexusClientStats;
  /** Stop the timer and flush within `deadlineMs` (default 5 s). NEVER rejects. */
  shutdown(deadlineMs?: number): Promise<void>;
  /** The trusted proxy hop count adapters should use. */
  readonly trustProxyHops: number;
  /** The SDK identity this client reports. */
  readonly sdk: { name: string; version: string };
}
