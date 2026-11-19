import { INGEST_HEADERS } from '@nexus/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupHarness, TEST_SCOPE, TEST_URL, type Harness } from '../test-harness';
import { globalState, sharedSessionStore } from './global-state';
import {
  createHeaderSource,
  headerSourceFor,
  isPropagationAllowed,
  shouldDecorate,
  type HeaderSource,
} from './header-source';
import { ingestExcludeUrls } from './ingest-urls';

let h: Harness;
beforeEach(() => {
  h = setupHarness();
});
afterEach(() => {
  h.teardown();
});

function source(
  pageView: () => { id: string; sessionId: string } | null = () => null,
  allowOrigins: readonly string[] = [],
): HeaderSource {
  return createHeaderSource({
    keyScope: TEST_SCOPE,
    excludeUrls: ingestExcludeUrls(TEST_URL),
    allowOrigins,
    pageView,
  });
}

describe('shouldDecorate', () => {
  it('same-origin yes; cross-origin only when allow-listed (exact origin)', () => {
    const plain = source();
    const listed = source(() => null, ['https://api.example.com/', 'not a url']);
    expect(shouldDecorate('/api/x', plain)).toBe(true);
    expect(shouldDecorate(`${window.location.origin}/api/x`, plain)).toBe(true);
    expect(shouldDecorate('https://api.example.com/x', plain)).toBe(false);
    expect(shouldDecorate('https://api.example.com/x', listed)).toBe(true);
    expect(shouldDecorate('https://api.example.com:8443/x', listed)).toBe(false);
    expect(listed.allowOrigins).toEqual(['https://api.example.com']);
  });

  it('never decorates either ingest URL (browser and config)', () => {
    const sameOrigin = createHeaderSource({
      keyScope: TEST_SCOPE,
      excludeUrls: ingestExcludeUrls(`${window.location.origin}/traffic`),
      allowOrigins: [],
      pageView: () => null,
    });
    expect(shouldDecorate('/traffic/api/v1/ingest/browser', sameOrigin)).toBe(false);
    expect(shouldDecorate('/traffic/api/v1/ingest/config', sameOrigin)).toBe(false);
    expect(shouldDecorate('/traffic/api/v1/other', sameOrigin)).toBe(true);
    const listed = source(() => null, ['https://nexus.libas.in']);
    expect(shouldDecorate(`${TEST_URL}/api/v1/ingest/browser`, listed)).toBe(false);
    expect(shouldDecorate(`${TEST_URL}/api/v1/ingest/config`, listed)).toBe(false);
  });

  it('reads the kill switch and the remote module switch LIVE', () => {
    const s = source();
    globalState().headerSources.add(s);
    expect(headerSourceFor('/api/x')).toBe(s);
    globalState().remote.set(TEST_SCOPE, {
      contract: 1,
      version: 2,
      enabled: true,
      disabledModules: ['header_propagation'],
      maxAgeMs: 1,
    });
    expect(isPropagationAllowed(s)).toBe(false);
    expect(headerSourceFor('/api/x')).toBeUndefined();
    globalState().remote.delete(TEST_SCOPE);
    expect(shouldDecorate('/api/x', s)).toBe(true);
    globalState().disabledKeys.add(TEST_SCOPE);
    expect(shouldDecorate('/api/x', s)).toBe(false);
  });
});

describe('headerSourceFor (per-request choice)', () => {
  it('an allow-listed origin of the EARLY source is still decorated after a tracker source without one', () => {
    const early = source(() => null, ['https://api.example.com']);
    const tracker = source();
    globalState().headerSources.add(early);
    globalState().headerSources.add(tracker);
    expect(headerSourceFor('/api/x')).toBe(tracker);
    expect(headerSourceFor('https://api.example.com/v1/items')).toBe(early);
    expect(headerSourceFor('https://other.example.com/v1/items')).toBeUndefined();
  });
});

describe('relative URLs and <base href>', () => {
  it('resolves against document.baseURI, like fetch: a cross-origin <base> is NOT same-origin', () => {
    const base = document.createElement('base');
    base.href = 'https://api.partner.com/';
    document.head.appendChild(base);
    try {
      expect(shouldDecorate('v1/items', source())).toBe(false);
      expect(shouldDecorate('v1/items', source(() => null, ['https://api.partner.com']))).toBe(true);
    } finally {
      base.remove();
    }
    expect(shouldDecorate('v1/items', source())).toBe(true);
  });
});

describe('headers()', () => {
  it('pairs the page view only with its own session', () => {
    const sid = sharedSessionStore().peekCurrent(Date.now());
    let view = { id: 'view-1', sessionId: sid };
    const s = source(() => view);
    expect(s.headers()).toEqual({ [INGEST_HEADERS.session]: sid, [INGEST_HEADERS.pageView]: 'view-1' });
    view = { id: 'view-1', sessionId: 'another-session' };
    expect(s.headers()).toEqual({ [INGEST_HEADERS.session]: sid });
  });

  it('idle: a peek after the idle window rotates once and drops the old page view', () => {
    const store = sharedSessionStore();
    const first = store.nextEvent('a@libas.in', Date.now());
    const s = source(() => ({ id: 'old-view', sessionId: first.sessionId }));
    expect(s.headers()[INGEST_HEADERS.pageView]).toBe('old-view');

    vi.advanceTimersByTime(31 * 60 * 1000);
    const afterIdle = s.headers();
    const rotated = afterIdle[INGEST_HEADERS.session]!;
    expect(rotated).not.toBe(first.sessionId);
    expect(afterIdle[INGEST_HEADERS.pageView]).toBeUndefined();
    // rotated ONCE: the next peek and the next event use the same new id
    expect(s.headers()[INGEST_HEADERS.session]).toBe(rotated);
    expect(store.nextEvent('a@libas.in', Date.now())).toEqual({ sessionId: rotated, seq: 0 });
  });

  it('a header peek never rotates on an email change', () => {
    const store = sharedSessionStore();
    const first = store.nextEvent('a@libas.in', Date.now());
    const s = source();
    vi.advanceTimersByTime(1000);
    expect(s.headers()[INGEST_HEADERS.session]).toBe(first.sessionId);
    expect(s.headers()[INGEST_HEADERS.session]).toBe(first.sessionId);
  });
});
