import { describe, expect, it } from 'vitest';

import { INGEST_LIMITS } from '../constants/ingest';
import { BROWSER_BATCH_EXAMPLE, SDK_CONFIG_RESPONSE_EXAMPLE, SERVER_BATCH_EXAMPLE } from './examples';
import {
  browserEventSchema,
  browserIngestBatchSchema,
  browserIngestEnvelopeSchema,
  serverEventSchema,
  serverIngestBatchSchema,
  serverIngestEnvelopeSchema,
  sdkConfigRequestSchema,
  sdkRemoteConfigSchema,
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

describe('environment, release and client context (Phase A)', () => {
  it('the examples carry environment and release and still parse', () => {
    expect(serverIngestEnvelopeSchema.parse(SERVER_BATCH_EXAMPLE).environment).toBe('prod');
    const browser = browserIngestEnvelopeSchema.parse(BROWSER_BATCH_EXAMPLE);
    expect(browser.environment).toBe('prod');
    expect(browser.release).toBe('2026.11.18-a1b2c3d');
    const pageView = browserEventSchema.parse(BROWSER_BATCH_EXAMPLE.events[0]);
    expect(pageView.routeTemplate).toBe(pageView.path);
  });

  it('an unknown environment string still parses (lenient: the API warns, never 400s)', () => {
    const server = { ...SERVER_BATCH_EXAMPLE, environment: 'production' };
    expect(serverIngestEnvelopeSchema.safeParse(server).success).toBe(true);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, environment: 'qa' }).success).toBe(true);
    const tooLong = 'x'.repeat(INGEST_LIMITS.maxEnvironmentWireLength + 1);
    expect(serverIngestEnvelopeSchema.safeParse({ ...SERVER_BATCH_EXAMPLE, environment: tooLong }).success).toBe(false);
    expect(serverIngestEnvelopeSchema.safeParse({ ...SERVER_BATCH_EXAMPLE, environment: '' }).success).toBe(false);
  });

  it('limits release, tz and lang, and accepts the replay flag', () => {
    const release = 'r'.repeat(INGEST_LIMITS.maxReleaseLength + 1);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, release }).success).toBe(false);
    const client = BROWSER_BATCH_EXAMPLE.client;
    const tz = 'z'.repeat(INGEST_LIMITS.maxClientTzLength + 1);
    const lang = 'l'.repeat(INGEST_LIMITS.maxClientLangLength + 1);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, client: { ...client, tz } }).success).toBe(false);
    expect(browserIngestEnvelopeSchema.safeParse({ ...BROWSER_BATCH_EXAMPLE, client: { ...client, lang } }).success).toBe(false);
    const replay = browserIngestEnvelopeSchema.parse({ ...BROWSER_BATCH_EXAMPLE, client: { ...client, replay: true } });
    expect(replay.client?.replay).toBe(true);
  });
});

describe('SDK remote config contract (Phase A)', () => {
  it('the response example parses', () => {
    expect(sdkRemoteConfigSchema.safeParse(SDK_CONFIG_RESPONSE_EXAMPLE).success).toBe(true);
  });

  it('refuses another contract version and unknown modules', () => {
    expect(sdkRemoteConfigSchema.safeParse({ ...SDK_CONFIG_RESPONSE_EXAMPLE, contract: 2 }).success).toBe(false);
    expect(
      sdkRemoteConfigSchema.safeParse({ ...SDK_CONFIG_RESPONSE_EXAMPLE, disabledModules: ['everything'] }).success,
    ).toBe(false);
  });

  it('the request needs a key; client is optional but complete', () => {
    expect(sdkConfigRequestSchema.safeParse({ key: BROWSER_BATCH_EXAMPLE.key }).success).toBe(true);
    expect(sdkConfigRequestSchema.safeParse({ key: '' }).success).toBe(false);
    expect(
      sdkConfigRequestSchema.safeParse({ key: BROWSER_BATCH_EXAMPLE.key, client: { sdk: '@nexus/react' } }).success,
    ).toBe(false);
    expect(
      sdkConfigRequestSchema.safeParse({
        key: BROWSER_BATCH_EXAMPLE.key,
        client: { sdk: '@nexus/react', version: '1.1.0' },
      }).success,
    ).toBe(true);
  });
});
