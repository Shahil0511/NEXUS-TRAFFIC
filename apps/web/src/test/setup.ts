/**
 * Global test setup: DOM matchers, MSW lifecycle and the browser APIs jsdom lacks.
 *
 * WHY THE STUBS: recharts' ResponsiveContainer needs ResizeObserver, next-themes and motion read
 * matchMedia, and Radix Select calls pointer-capture/scrollIntoView. jsdom implements none of them.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './msw';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installBrowserStubs(): void {
  if (typeof window === 'undefined') return;
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}

/**
 * jsdom installs its OWN AbortController/AbortSignal, while `fetch`/`Request` stay Node's (undici),
 * which rejects a foreign signal ("Expected signal to be an instance of AbortSignal"). Tests never
 * abort, so the signal is dropped before the (MSW-patched) fetch sees it. Browsers are unaffected.
 */
function dropForeignAbortSignals(): void {
  if (typeof window === 'undefined') return;
  const patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => patchedFetch(input, init && { ...init, signal: undefined });
}

installBrowserStubs();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  dropForeignAbortSignals();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
