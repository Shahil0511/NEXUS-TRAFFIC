/**
 * Snippet ↔ contract tests.
 *
 * WHY: the SDKs and the copy-paste snippets in docs/snippets/ are what other teams actually run.
 * These tests prove (1) the batches the SDK sends validate against the PUBLIC zod contract and
 * (2) every ingest URL a snippet builds equals buildIngestUrl() — so docs, snippets and SDKs
 * cannot drift apart. Importing zod here is fine: tests are never bundled.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ROUTES, serverIngestBatchSchema, type ServerEventInput } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { createEventId, createNexusClient, DEFAULT_NEXUS_URL, buildIngestUrl } from './index';
import type { NexusServerBatch, NexusServerEvent } from './types';

const SNIPPETS_DIR = path.resolve(__dirname, '../../../docs/snippets');

function snippetFiles(): Array<{ name: string; source: string }> {
  return readdirSync(SNIPPETS_DIR)
    .filter((name) => !name.startsWith('.'))
    .map((name) => ({ name, source: readFileSync(path.join(SNIPPETS_DIR, name), 'utf8') }));
}

/** Send events through a real client with a capturing fetch; return the batches it POSTed. */
async function capturedBatches(events: NexusServerEvent[], sdk?: { name: string; version: string }) {
  const bodies: Array<{ url: string; body: NexusServerBatch }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    bodies.push({ url, body: JSON.parse(init.body as string) as NexusServerBatch });
    return new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [], warnings: [] }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  });
  const client = createNexusClient({
    url: process.env['NEXUS_URL'] ?? DEFAULT_NEXUS_URL,
    key: 'nx_sk_contract',
    fetch,
    logger: { warn: () => undefined },
    ...(sdk ? { sdk } : {}),
  });
  for (const event of events) client.track(event);
  await client.shutdown();
  return bodies;
}

/** A minimal event: only the required fields (what the snippets always send). */
function minimalEvent(): NexusServerEvent {
  return {
    eventId: createEventId(),
    occurredAt: new Date().toISOString(),
    method: 'GET',
    path: '/ebo-sales/api/stores/42',
    status: 200,
    durationMs: 12.3,
  };
}

/** Every optional field filled, as nexusMiddleware builds it. */
function fullEvent(): NexusServerEvent {
  return {
    ...minimalEvent(),
    kind: 'stream',
    method: 'POST',
    routeTemplate: '/ebo-sales/api/stores/:id',
    status: 422,
    ip: '203.0.113.9',
    userEmail: 'someone@libas.in',
    requestId: 'req-123',
    userAgent: 'Mozilla/5.0',
    requestBytes: 120,
    responseBytes: 2048,
    errorCode: 'VALIDATION_ERROR',
    release: 'v1.2.3',
    sessionId: createEventId(),
    pageViewId: createEventId(),
  };
}

describe('SDK payloads validate against the public contract', () => {
  it('a minimal and a full event batch pass serverIngestBatchSchema', async () => {
    const [sent] = await capturedBatches([minimalEvent(), fullEvent()]);
    const result = serverIngestBatchSchema.safeParse(sent!.body);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(sent!.body.events).toHaveLength(2);
  });

  it('the adapter sdk identity fits the contract limits', async () => {
    const [sent] = await capturedBatches([minimalEvent()], { name: '@nexus/express', version: '1.0.0' });
    expect(serverIngestBatchSchema.safeParse(sent!.body).success).toBe(true);
  });

  it('a full 500-event batch passes (the max per request)', async () => {
    const events = Array.from({ length: 500 }, () => fullEvent());
    const batches = await capturedBatches(events);
    for (const { body } of batches) expect(serverIngestBatchSchema.safeParse(body).success).toBe(true);
    expect(batches.reduce((n, b) => n + b.body.events.length, 0)).toBe(500);
  });

  it('NexusServerEvent is assignable to the contract input type', () => {
    const event: ServerEventInput = fullEvent();
    expect(event.eventId).toBeTruthy();
  });

  it('the SDK posts to buildIngestUrl(NEXUS_URL, ROUTES.ingest.server)', async () => {
    const [sent] = await capturedBatches([minimalEvent()]);
    expect(sent!.url).toBe(`${DEFAULT_NEXUS_URL}/api${ROUTES.ingest.server.path}`);
    expect(sent!.url).toBe(buildIngestUrl(DEFAULT_NEXUS_URL));
  });
});

describe('docs/snippets use the same URLs as buildIngestUrl', () => {
  const files = snippetFiles();
  const INGEST_PATH = /(?:\/api|\$\{API\})(\/v1\/ingest\/[a-z]+)/g;
  const leaves = Object.fromEntries(
    Object.entries(ROUTES.ingest).map(([leaf, route]) => [route.path, leaf as 'server' | 'browser' | 'verify']),
  );

  it('found the snippets', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.name, f.source] as const))('%s: every ingest path matches ROUTES via buildIngestUrl', (_name, source) => {
    for (const match of source.matchAll(INGEST_PATH)) {
      const routePath = match[1]!;
      const leaf = leaves[routePath];
      expect(leaf, `unknown ingest path ${routePath}`).toBeDefined();
      expect(`${DEFAULT_NEXUS_URL}/api${routePath}`).toBe(buildIngestUrl(DEFAULT_NEXUS_URL, leaf));
    }
  });

  it.each(files.map((f) => [f.name, f.source] as const))('%s: the default NEXUS_URL equals DEFAULT_NEXUS_URL (no /api)', (_name, source) => {
    const urls = source.match(/https:\/\/nexus\.libas\.in[^\s'"`)}]*/g) ?? [];
    for (const url of urls.map((u) => u.replace(/[.,;:]+$/, ''))) {
      const docsHome = `${DEFAULT_NEXUS_URL}/api${ROUTES.docs.home.path}`;
      expect([DEFAULT_NEXUS_URL, docsHome], `unexpected URL ${url}`).toContain(url);
    }
  });

  it('the curl snippet derives API as NEXUS_URL + /api', () => {
    const curl = files.find((f) => f.name === 'curl.sh');
    if (!curl) return;
    expect(curl.source).toContain('API="${NEXUS_URL%/}/api"');
  });
});
