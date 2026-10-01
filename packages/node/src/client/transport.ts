import { INGEST_HEADERS } from '@nexus/shared/constants';

import type { NexusFetch, NexusServerBatch, NexusServerEvent } from '../types';
import type { RawIngestResponse } from './response-classifier';

export interface TransportConfig {
  endpoint: string;
  key: string;
  sdk: { name: string; version: string };
  requestTimeoutMs: number;
  fetch: NexusFetch;
}

/**
 * WHY: the ONLY place that speaks HTTP. One call = one attempt; `sentAt` is re-stamped on EVERY
 * attempt while the events (eventId, occurredAt) are resent unchanged. Network errors and
 * timeouts REJECT; the delivery loop decides what to do with them.
 */
export class IngestTransport {
  constructor(private readonly config: TransportConfig) {}

  async send(events: readonly NexusServerEvent[]): Promise<RawIngestResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.config.fetch(this.config.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.envelope(events)),
        redirect: 'manual',
        signal: controller.signal,
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        retryAfter: response.headers.get('retry-after'),
        body: await response.text(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      [INGEST_HEADERS.key]: this.config.key,
      [INGEST_HEADERS.sdk]: `${this.config.sdk.name}@${this.config.sdk.version}`,
    };
  }

  private envelope(events: readonly NexusServerEvent[]): NexusServerBatch {
    return { sentAt: new Date().toISOString(), sdk: this.config.sdk, events: [...events] };
  }
}
