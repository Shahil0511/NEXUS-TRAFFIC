import { INGEST_LIMITS, serverIngestBatchSchema } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { clampSampleCount, generateServerEvents, SAMPLE_WINDOW_MS, toValidatedBatches } from './sample-traffic';

/** Deterministic PRNG (mulberry32) so the test is reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);

describe('generateServerEvents', () => {
  const events = generateServerEvents({ count: 1200, nowMs: NOW, random: seeded(42) });

  it('produces contract-valid batches of at most 500 events', () => {
    const batches = toValidatedBatches(events, NOW);
    expect(batches.map((b) => b.events.length)).toEqual([500, 500, 200]);
    for (const batch of batches) {
      expect(batch.events.length).toBeLessThanOrEqual(INGEST_LIMITS.server.maxEvents);
      expect(serverIngestBatchSchema.safeParse(batch).success).toBe(true);
    }
  });

  it('spreads events over the last 6 hours, under /demo', () => {
    for (const e of events) {
      const t = Date.parse(e.occurredAt);
      expect(t).toBeLessThan(NOW);
      expect(t).toBeGreaterThanOrEqual(NOW - SAMPLE_WINDOW_MS);
      expect(e.path.startsWith('/demo/')).toBe(true);
    }
  });

  it('is varied: several routes, methods, mostly 2xx with some 4xx and 5xx, users and IPs', () => {
    const statuses = events.map((e) => e.status);
    const share = (pred: (s: number) => boolean) => statuses.filter(pred).length / statuses.length;
    expect(share((s) => s < 400)).toBeGreaterThan(0.8);
    expect(share((s) => s >= 400 && s < 500)).toBeGreaterThan(0.02);
    expect(share((s) => s >= 500)).toBeGreaterThan(0.01);
    expect(new Set(events.map((e) => e.routeTemplate)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(events.map((e) => e.method))).toEqual(new Set(['GET', 'POST', 'PATCH', 'DELETE']));
    expect(new Set(events.map((e) => e.userEmail).filter(Boolean)).size).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => !e.userEmail || e.userEmail.endsWith('@libas.in'))).toBe(true);
    expect(new Set(events.map((e) => e.ip))).toContain('8.8.8.8');
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
  });

  it('only sends error codes on errors', () => {
    for (const e of events) {
      if (e.status < 400) expect(e.errorCode).toBeUndefined();
      else expect(e.errorCode).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('clampSampleCount', () => {
  it.each([
    ['200', 200],
    [7, 7],
    ['0', 200],
    ['abc', 200],
    [999999, 5000],
  ])('%s → %s', (input, expected) => {
    expect(clampSampleCount(input)).toBe(expected);
  });
});
