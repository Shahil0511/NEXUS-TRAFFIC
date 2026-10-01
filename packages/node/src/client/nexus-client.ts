import { INGEST_LIMITS, SDK_DEFAULTS } from '@nexus/shared/constants';
import { buildIngestUrl } from '@nexus/shared/ingest/build-ingest-url';
import { ROUTES } from '@nexus/shared/routes';

import type {
  NexusClient,
  NexusClientOptions,
  NexusClientStats,
  NexusFetch,
  NexusLogger,
  NexusServerEvent,
} from '../types';
import { SDK_NAME, SDK_VERSION } from '../version';
import { BatchDelivery, type DeliveryCounters, type SendPause } from './batch-delivery';
import { splitIntoBatches } from './batch-splitter';
import { sleep } from './delays';
import { Diagnostics } from './diagnostics';
import { EventQueue } from './event-queue';
import { IngestTransport } from './transport';

const DEFAULT_SHUTDOWN_DEADLINE_MS = 5_000;
const DEFAULT_TRUST_PROXY_HOPS = 1;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Settings after defaults are applied. */
interface ResolvedSettings {
  endpoint: string;
  key: string;
  maxQueue: number;
  flushEvents: number;
  flushIntervalMs: number;
  requestTimeoutMs: number;
  fetch: NexusFetch;
  sdk: { name: string; version: string };
  trustProxyHops: number;
}

/** A positive integer option, or the default. */
function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** WHY: hop count 0 is valid (app exposed directly); anything else invalid falls back to 1. */
function hopsOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_TRUST_PROXY_HOPS;
}

/** WHY: the secret key travels in a header — plain http off-box leaks it to the network. */
function warnIfInsecure(url: string, diagnostics: Diagnostics): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
      diagnostics.loudOnce('insecure-url', `NEXUS_URL uses plain http:// (${parsed.host}) — the secret key is sent unencrypted; use https://`);
    }
  } catch {
    // validated by resolveSettings
  }
}

/** Apply defaults; `null` means "run as the no-op client". */
function resolveSettings(options: NexusClientOptions): ResolvedSettings | null {
  const url = options.url?.trim();
  const key = options.key?.trim();
  const fetchImpl = options.fetch ?? (globalThis.fetch as NexusFetch | undefined);
  if (options.disabled || !url || !key || !fetchImpl) return null;
  new URL(url); // throws on garbage → caller falls back to no-op
  const server = SDK_DEFAULTS.server;
  return {
    endpoint: buildIngestUrl(url, ROUTES.ingest.server),
    key,
    maxQueue: positiveInt(options.maxQueue, server.maxQueue),
    flushEvents: positiveInt(options.flushEvents, server.flushEvents),
    flushIntervalMs: positiveInt(options.flushIntervalMs, server.flushIntervalMs),
    requestTimeoutMs: positiveInt(options.requestTimeoutMs, server.requestTimeoutMs),
    fetch: fetchImpl,
    sdk: options.sdk ?? { name: SDK_NAME, version: SDK_VERSION },
    trustProxyHops: hopsOf(options.trustProxyHops),
  };
}

/** WHY: an unconfigured environment (local dev, CI) must cost nothing and log nothing. */
function createNoopClient(options: NexusClientOptions): NexusClient {
  const stats: NexusClientStats = {
    queued: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    dropped: 0,
    attempts: 0,
    paused: false,
    enabled: false,
  };
  return {
    track: () => undefined,
    flush: () => Promise.resolve(),
    stats: () => ({ ...stats }),
    shutdown: () => Promise.resolve(),
    trustProxyHops: hopsOf(options.trustProxyHops),
    sdk: options.sdk ?? { name: SDK_NAME, version: SDK_VERSION },
  };
}

/**
 * The live client: queue → batches → BatchDelivery. Flushes when `flushEvents` are queued or every
 * `flushIntervalMs` (unref'd timer). Only ONE drain runs at a time; flush() joins it.
 */
class QueuedNexusClient implements NexusClient, SendPause {
  readonly trustProxyHops: number;
  readonly sdk: { name: string; version: string };
  private readonly queue: EventQueue;
  private readonly counters: DeliveryCounters = { accepted: 0, duplicates: 0, rejected: 0, attempts: 0 };
  private readonly delivery: BatchDelivery;
  private readonly timer: ReturnType<typeof setInterval>;
  private pausedUntil = 0;
  private draining: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly settings: ResolvedSettings, private readonly diagnostics: Diagnostics) {
    this.trustProxyHops = settings.trustProxyHops;
    this.sdk = settings.sdk;
    this.queue = new EventQueue(settings.maxQueue);
    const transport = new IngestTransport(settings);
    this.delivery = new BatchDelivery(transport, this.queue, this.counters, this, diagnostics, settings.endpoint);
    this.timer = setInterval(() => void this.flush(), settings.flushIntervalMs);
    this.timer.unref?.();
  }

  track(event: NexusServerEvent): void {
    try {
      if (this.closed || typeof event !== 'object' || event === null) return;
      this.queue.push(event);
      if (this.queue.size >= this.settings.flushEvents) void this.flush();
    } catch {
      // NEVER throw into the host app
    }
  }

  flush(): Promise<void> {
    this.draining ??= this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.draining = null;
      });
    return this.draining;
  }

  stats(): NexusClientStats {
    return {
      queued: this.queue.size,
      ...this.counters,
      dropped: this.queue.dropped,
      paused: this.isPaused(),
      enabled: true,
    };
  }

  async shutdown(deadlineMs: number = DEFAULT_SHUTDOWN_DEADLINE_MS): Promise<void> {
    try {
      this.closed = true;
      clearInterval(this.timer);
      await Promise.race([this.flush(), sleep(deadlineMs)]);
    } catch {
      // NEVER reject
    }
  }

  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  /** Send queued events chunk by chunk until the queue is empty or sending is paused. */
  private async drain(): Promise<void> {
    while (this.queue.size > 0 && !this.isPaused()) {
      const chunk = this.queue.take(INGEST_LIMITS.server.maxEvents);
      const { batches, oversize } = splitIntoBatches(
        chunk,
        INGEST_LIMITS.server.maxEvents,
        INGEST_LIMITS.server.maxBodyBytes,
      );
      if (oversize.length > 0) {
        this.queue.countDropped(oversize.length);
        this.diagnostics.warn('oversize', `${oversize.length} event(s) over the body limit dropped`);
      }
      const keep: NexusServerEvent[] = [];
      for (const batch of batches) {
        if (this.isPaused()) keep.push(...batch);
        else keep.push(...(await this.delivery.deliver(batch)));
      }
      if (keep.length > 0) this.queue.requeue(keep);
    }
  }
}

/**
 * WHY: the one entry point of the SDK. Returns a no-op client when `url` or `key` is missing (so
 * dev/CI need no config), and NEVER throws — even for a malformed URL.
 *
 *   const nexus = createNexusClient({ url: process.env.NEXUS_URL, key: process.env.NEXUS_SECRET_KEY });
 */
export function createNexusClient(options: NexusClientOptions = {}): NexusClient {
  const logger: NexusLogger = options.logger ?? console;
  const diagnostics = new Diagnostics(logger);
  try {
    const settings = resolveSettings(options);
    if (settings === null) return createNoopClient(options);
    warnIfInsecure(settings.endpoint, diagnostics);
    return new QueuedNexusClient(settings, diagnostics);
  } catch {
    diagnostics.loudOnce('config', 'NEXUS_URL is not a valid URL — Nexus tracking is disabled');
    return createNoopClient(options);
  }
}
