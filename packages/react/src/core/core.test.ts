import { buildIngestUrl } from '@nexus/shared/ingest/build-ingest-url';
import { ROUTES } from '@nexus/shared/routes';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EventBatcher, byteLength } from './event-batcher';
import { externalReferrerHost, joinBasePath, toWirePath } from './paths';
import { resolveIngestUrl } from './registry';
import { SafeStorage } from './safe-storage';
import { cleanProps, cleanTrackOptions, isValidName } from './sanitize';
import { SDK_VERSION } from './sdk-info';
import { SessionStore, shouldRotate } from './session-store';
import { createUuid, isUuid } from './uuid';
import { VisibleTimer } from './visible-timer';
import type { BrowserWireEvent } from './wire';

describe('paths', () => {
  it('strips query and hash and forces a leading slash', () => {
    expect(toWirePath('/a/b?token=x#frag')).toBe('/a/b');
    expect(toWirePath('a')).toBe('/a');
  });

  it('joins the base path that routers exclude', () => {
    expect(joinBasePath('/my-app', '/audits')).toBe('/my-app/audits');
    expect(joinBasePath('my-app/', '/')).toBe('/my-app');
    expect(joinBasePath('', '/audits')).toBe('/audits');
    expect(joinBasePath(undefined, 'x')).toBe('/x');
  });

  it('reports an EXTERNAL referrer host only, never a URL', () => {
    expect(externalReferrerHost('https://mail.google.com/mail/u/0?x=1', 'nexus.libas.in')).toBe(
      'mail.google.com',
    );
    expect(externalReferrerHost('https://nexus.libas.in/other', 'nexus.libas.in')).toBeUndefined();
    expect(externalReferrerHost('not a url', 'x')).toBeUndefined();
    expect(externalReferrerHost('', 'x')).toBeUndefined();
  });

  it('derives the ingest URL with buildIngestUrl and accepts a full one', () => {
    const expected = buildIngestUrl('https://nexus.libas.in/traffic', ROUTES.ingest.browser);
    expect(resolveIngestUrl('https://nexus.libas.in/traffic/')).toBe(expected);
    expect(resolveIngestUrl(expected)).toBe(expected);
  });
});

describe('uuid', () => {
  it('creates RFC v4 ids', () => {
    expect(isUuid(createUuid())).toBe(true);
    expect(isUuid('nope')).toBe(false);
  });
});

describe('sanitize', () => {
  it('validates tool names against TOOL_NAME_PATTERN', () => {
    expect(isValidName('audits.export-csv')).toBe(true);
    expect(isValidName('Bad Name')).toBe(false);
    expect(isValidName('')).toBe(false);
  });

  it('drops invalid props, keeps at most 10 and clips strings', () => {
    const props: Record<string, unknown> = { Bad: 1, nested: { a: 1 }, nan: Number.NaN, s: 'x'.repeat(300) };
    for (let i = 0; i < 12; i++) props[`k${i}`] = i;
    const clean = cleanProps(props)!;
    expect(clean['Bad']).toBeUndefined();
    expect(clean['nested']).toBeUndefined();
    expect(clean['nan']).toBeUndefined();
    expect((clean['s'] as string).length).toBe(128);
    expect(Object.keys(clean)).toHaveLength(10);
  });

  it('omits unknown actions, blank labels and non-finite values', () => {
    expect(
      cleanTrackOptions({ action: 'nope' as never, label: '  ', value: Number.POSITIVE_INFINITY }),
    ).toEqual({});
  });
});

describe('VisibleTimer', () => {
  it('counts visible time only and hands out deltas', () => {
    const timer = new VisibleTimer();
    timer.reset(0, true);
    timer.pause(3000);
    timer.resume(10_000);
    expect(timer.take(12_000)).toBe(5000);
    expect(timer.take(13_000)).toBe(1000);
  });
});

describe('SafeStorage', () => {
  it('falls back to memory when storage throws', () => {
    const storage = new SafeStorage(() => {
      throw new Error('SecurityError');
    });
    storage.set('a', '1');
    expect(storage.get('a')).toBe('1');
  });

  it('keeps the value in memory when setItem starts failing', () => {
    let fail = false;
    const backing = new Map<string, string>();
    const storage = new SafeStorage(
      () =>
        ({
          getItem: (k: string) => {
            if (fail) throw new Error('blocked');
            return backing.get(k) ?? null;
          },
          setItem: (k: string, v: string) => {
            if (fail) throw new Error('QuotaExceeded');
            backing.set(k, v);
          },
        }) as unknown as Storage,
    );
    storage.set('a', '1');
    fail = true;
    storage.set('a', '2');
    expect(storage.get('a')).toBe('2');
  });
});

describe('SessionStore', () => {
  const idle = 1000;

  it('increments seq and rotates after idle', () => {
    const store = new SessionStore(new SafeStorage(() => undefined), idle);
    const a = store.nextEvent(undefined, 0);
    const b = store.nextEvent(undefined, 500);
    expect(b).toEqual({ sessionId: a.sessionId, seq: 1 });
    const c = store.nextEvent(undefined, 500 + idle + 1);
    expect(c.sessionId).not.toBe(a.sessionId);
    expect(c.seq).toBe(0);
  });

  it('rotation rules: user change and sign-out rotate, sign-in adopts', () => {
    expect(shouldRotate({ lastActivityAt: 0 }, 'a@x.in', 1, idle)).toBe(false);
    expect(shouldRotate({ lastActivityAt: 0, email: 'a@x.in' }, 'b@x.in', 1, idle)).toBe(true);
    expect(shouldRotate({ lastActivityAt: 0, email: 'a@x.in' }, undefined, 1, idle)).toBe(true);
    expect(shouldRotate({ lastActivityAt: 0, email: 'a@x.in' }, 'a@x.in', 1, idle)).toBe(false);
  });

  it('ignores corrupt stored records', () => {
    const backing = new SafeStorage(() => undefined);
    backing.set('nexus.session', '{"id":"bad","seq":-1}');
    const store = new SessionStore(backing, idle);
    expect(isUuid(store.nextEvent(undefined, 0).sessionId)).toBe(true);
  });
});

describe('EventBatcher', () => {
  const event = (n: number, label = ''): BrowserWireEvent => ({
    type: 'custom',
    name: 'x.y',
    eventId: `id-${n}`,
    occurredAt: '2026-10-01T09:00:00.000Z',
    seq: n,
    path: '/a',
    ...(label ? { label } : {}),
  });
  const serialize = (ctx: { sessionId: string }, events: BrowserWireEvent[]): string =>
    JSON.stringify({ sessionId: ctx.sessionId, events });

  it('flushes at flushEvents and splits by maxEvents', () => {
    const sent: string[] = [];
    const batcher = new EventBatcher(serialize, (json) => sent.push(json), {
      flushEvents: 100,
      maxQueue: 1000,
      maxEvents: 3,
      maxBodyBytes: 60_000,
    });
    for (let i = 0; i < 7; i++) batcher.enqueue(event(i), { sessionId: 's' });
    batcher.flush();
    expect(sent.map((s) => (JSON.parse(s) as { events: unknown[] }).events.length)).toEqual([3, 3, 1]);
  });

  it('keeps every request under maxBodyBytes', () => {
    const sent: string[] = [];
    const batcher = new EventBatcher(serialize, (json) => sent.push(json), {
      flushEvents: 100,
      maxQueue: 1000,
      maxEvents: 50,
      maxBodyBytes: 1000,
    });
    for (let i = 0; i < 20; i++) batcher.enqueue(event(i, 'é'.repeat(60)), { sessionId: 's' });
    batcher.flush();
    expect(sent.length).toBeGreaterThan(1);
    for (const body of sent) expect(byteLength(body)).toBeLessThanOrEqual(1000);
    expect(sent.flatMap((s) => (JSON.parse(s) as { events: unknown[] }).events)).toHaveLength(20);
  });

  it('drops the oldest beyond maxQueue and flushes on a session change', () => {
    const sent: string[] = [];
    const batcher = new EventBatcher(serialize, (json) => sent.push(json), {
      flushEvents: 100,
      maxQueue: 2,
      maxEvents: 50,
      maxBodyBytes: 60_000,
    });
    for (let i = 0; i < 3; i++) batcher.enqueue(event(i), { sessionId: 's1' });
    expect(batcher.droppedCount()).toBe(1);
    batcher.enqueue(event(9), { sessionId: 's2' });
    expect(JSON.parse(sent[0]!)).toMatchObject({ sessionId: 's1', events: [{ seq: 1 }, { seq: 2 }] });
    batcher.flush();
    expect(JSON.parse(sent[1]!)).toMatchObject({ sessionId: 's2', events: [{ seq: 9 }] });
  });
});

describe('package metadata', () => {
  it('SDK_VERSION matches package.json and dependencies stay EMPTY', () => {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')) as {
      version: string;
      dependencies?: Record<string, string>;
    };
    expect(SDK_VERSION).toBe(pkg.version);
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
