import { describe, expect, it } from 'vitest';

import { BROWSER_BATCH_EXAMPLE, SERVER_BATCH_EXAMPLE } from './examples';
import {
  browserEventSchema,
  browserIngestBatchSchema,
  browserIngestEnvelopeSchema,
  serverEventSchema,
  serverIngestBatchSchema,
  serverIngestEnvelopeSchema,
} from './schemas';

const baseServerEvent = SERVER_BATCH_EXAMPLE.events[0]!;

describe('server ingest contract', () => {
  it('accepts the canonical example batch', () => {
    expect(serverIngestBatchSchema.safeParse(SERVER_BATCH_EXAMPLE).success).toBe(true);
  });

  it('defaults kind to http and upper-cases the method', () => {
    const { kind: _kind, ...withoutKind } = baseServerEvent;
    const parsed = serverEventSchema.parse({ ...withoutKind, method: 'post' });
    expect(parsed.kind).toBe('http');
    expect(parsed.method).toBe('POST');
  });

  it('requires eventId, occurredAt, method, path, status, durationMs', () => {
    for (const field of ['eventId', 'occurredAt', 'method', 'path', 'status', 'durationMs']) {
      const event: Record<string, unknown> = { ...baseServerEvent };
      delete event[field];
      expect(serverEventSchema.safeParse(event).success, field).toBe(false);
    }
  });

  it('rejects a non-absolute path (stored-XSS guard) and out-of-range status', () => {
    expect(serverEventSchema.safeParse({ ...baseServerEvent, path: 'javascript:alert(1)' }).success).toBe(false);
    expect(serverEventSchema.safeParse({ ...baseServerEvent, status: 99 }).success).toBe(false);
    expect(serverEventSchema.safeParse({ ...baseServerEvent, status: 600 }).success).toBe(false);
  });

  it('rejects error messages disguised as codes', () => {
    expect(serverEventSchema.safeParse({ ...baseServerEvent, errorCode: 'Timeout while exporting' }).success).toBe(false);
  });

  it('envelope keeps events opaque so one bad event does not fail the batch', () => {
    const parsed = serverIngestEnvelopeSchema.safeParse({ sentAt: SERVER_BATCH_EXAMPLE.sentAt, events: [{ junk: true }] });
    expect(parsed.success).toBe(true);
  });

  it('limits a batch to 500 events', () => {
    const events = Array.from({ length: 501 }, () => baseServerEvent);
    expect(serverIngestEnvelopeSchema.safeParse({ sentAt: SERVER_BATCH_EXAMPLE.sentAt, events }).success).toBe(false);
  });
});

describe('browser ingest contract', () => {
  it('accepts the canonical example batch', () => {
    expect(browserIngestBatchSchema.safeParse(BROWSER_BATCH_EXAMPLE).success).toBe(true);
  });

  it('discriminates on type and requires type-specific fields', () => {
    const pageTime = BROWSER_BATCH_EXAMPLE.events[2] as Record<string, unknown>;
    const { pageViewId: _omit, ...withoutViewId } = pageTime;
    expect(browserEventSchema.safeParse(withoutViewId).success).toBe(false);
    expect(browserEventSchema.safeParse({ ...pageTime, type: 'unknown' }).success).toBe(false);
  });

  it('rejects tool names that are not lower-case dotted identifiers', () => {
    const tool = BROWSER_BATCH_EXAMPLE.events[1]!;
    expect(browserEventSchema.safeParse({ ...tool, tool: 'Export CSV!' }).success).toBe(false);
  });

  it('limits a browser batch to 50 events and requires a uuid session', () => {
    const events = Array.from({ length: 51 }, () => BROWSER_BATCH_EXAMPLE.events[0]);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, events }).success).toBe(false);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, sessionId: 'abc' }).success).toBe(false);
  });

  it('caps props at 10 scalar entries', () => {
    const tool = BROWSER_BATCH_EXAMPLE.events[1]!;
    const props = Object.fromEntries(Array.from({ length: 11 }, (_v, i) => [`k${i}`, i]));
    expect(browserEventSchema.safeParse({ ...tool, props }).success).toBe(false);
    expect(browserEventSchema.safeParse({ ...tool, props: { nested: { a: 1 } } }).success).toBe(false);
  });
});
