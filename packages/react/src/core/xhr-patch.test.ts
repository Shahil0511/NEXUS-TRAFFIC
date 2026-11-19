import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupHarness, TEST_SCOPE, type Harness } from '../test-harness';
import { globalState, sharedSessionStore } from './global-state';
import { createHeaderSource } from './header-source';
import { ingestExcludeUrls } from './ingest-urls';
import { installXhrPatch, releaseXhrPatchIfOurs } from './xhr-patch';

/** A minimal XHR: records every call, throws like the real one on a bad URL / wrong state. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  openCalls: unknown[][] = [];
  headers: Array<[string, string]> = [];
  sent = 0;
  opened = false;
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(...args: unknown[]): void {
    this.openCalls.push(args);
    if (args[1] === 'http://[bad') throw new SyntaxError('Invalid URL');
    this.opened = true;
    this.headers = [];
  }
  setRequestHeader(name: string, value: string): void {
    if (!this.opened) throw new DOMException('not opened', 'InvalidStateError');
    this.headers.push([name, value]);
  }
  send(_body?: unknown): void {
    if (!this.opened) throw new DOMException('not opened', 'InvalidStateError');
    this.sent++;
  }
}

let h: Harness;
let originals: { open: unknown; send: unknown; setRequestHeader: unknown };

beforeEach(() => {
  h = setupHarness();
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  originals = {
    open: FakeXhr.prototype.open,
    send: FakeXhr.prototype.send,
    setRequestHeader: FakeXhr.prototype.setRequestHeader,
  };
  globalState().headerSources.add(
    createHeaderSource({
      keyScope: TEST_SCOPE,
      excludeUrls: ingestExcludeUrls(`${window.location.origin}/traffic`),
      allowOrigins: [],
      pageView: () => null,
    }),
  );
  installXhrPatch();
});

afterEach(() => {
  releaseXhrPatchIfOurs();
  h.teardown();
});

const xhr = () => new XMLHttpRequest() as unknown as FakeXhr;
const names = (x: FakeXhr) => x.headers.map(([n]) => n.toLowerCase());

describe('XHR patch', () => {
  it('keeps the async flag: open(method, url) is forwarded with exactly 2 arguments', () => {
    const x = xhr();
    x.open('GET', '/api/x');
    expect(x.openCalls).toEqual([['GET', '/api/x']]);
    x.open('GET', '/api/x', false);
    expect(x.openCalls[1]).toEqual(['GET', '/api/x', false]);
  });

  it('decorates a same-origin request on send', () => {
    const x = xhr();
    x.open('GET', '/api/x');
    x.send();
    expect(names(x)).toEqual(['x-nexus-session']);
    expect(x.headers[0]![1]).toBe(sharedSessionStore().peekCurrent(Date.now()));
    expect(x.sent).toBe(1);
  });

  it('a re-opened XHR resets its state (old app headers forgotten, new URL used)', () => {
    const x = xhr();
    x.open('GET', 'https://other.example.com/x');
    x.setRequestHeader('X-Nexus-Session', 'app-value');
    x.open('GET', '/api/x');
    x.send();
    expect(x.headers.map(([n, v]) => `${n}=${v.length > 20 ? 'uuid' : v}`)).toEqual(['X-Nexus-Session=uuid']);
  });

  it('an original open that throws throws exactly once and is not re-invoked', () => {
    const x = xhr();
    expect(() => x.open('GET', 'http://[bad')).toThrow(SyntaxError);
    expect(x.openCalls).toHaveLength(1);
    // never opened → our send decoration is skipped, the original's own error surfaces once
    expect(() => x.send()).toThrow('not opened');
  });

  it('never duplicates a header the app set itself', () => {
    const x = xhr();
    x.open('POST', '/api/x');
    x.setRequestHeader('x-nexus-session', 'mine');
    x.send('{}');
    expect(x.headers).toEqual([['x-nexus-session', 'mine']]);
  });

  it('cross-origin and ingest requests are left alone', () => {
    const a = xhr();
    a.open('GET', 'https://other.example.com/x');
    a.send();
    const b = xhr();
    b.open('POST', `${window.location.origin}/traffic/api/v1/ingest/config`);
    b.send('{}');
    expect(a.headers).toEqual([]);
    expect(b.headers).toEqual([]);
  });

  it('an axios-like request goes through unchanged except for our header', () => {
    // axios' xhr adapter: open(UPPER, url, true) → setRequestHeader per header → send(data)
    const x = xhr();
    x.open('POST', '/api/orders', true);
    x.setRequestHeader('Accept', 'application/json, text/plain, */*');
    x.setRequestHeader('Content-Type', 'application/json');
    x.send('{"a":1}');
    expect(names(x)).toEqual(['accept', 'content-type', 'x-nexus-session']);
    expect(x.sent).toBe(1);
  });

  it('is a pass-through while the key is killed, and restores the prototype if still ours', () => {
    globalState().disabledKeys.add(TEST_SCOPE);
    const x = xhr();
    x.open('GET', '/api/x');
    x.send();
    expect(x.headers).toEqual([]);
    releaseXhrPatchIfOurs();
    expect(FakeXhr.prototype.open).toBe(originals.open);
    expect(FakeXhr.prototype.send).toBe(originals.send);
    expect(FakeXhr.prototype.setRequestHeader).toBe(originals.setRequestHeader);
    expect(globalState().xhrPatch).toBeNull();
  });

  it('keeps the patch when someone wrapped the prototype after us', () => {
    const ours = FakeXhr.prototype.send;
    const theirs = function (this: FakeXhr, ...args: unknown[]) {
      return (ours as (...a: unknown[]) => void).apply(this, args);
    };
    FakeXhr.prototype.send = theirs;
    releaseXhrPatchIfOurs();
    expect(FakeXhr.prototype.send).toBe(theirs);
    expect(globalState().xhrPatch).not.toBeNull();
  });
});
