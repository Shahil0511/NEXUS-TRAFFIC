/**
 * Header propagation on `XMLHttpRequest` — axios and other XHR clients (ADR 0011).
 *
 * SEMANTICS (pinned, each one tested)
 * - Every wrapper is a `function` that calls `original.apply(this, arguments)` and returns its
 *   result unchanged: `open(method, url)` with 2 arguments must stay ASYNC.
 * - ONLY the decoration is inside try/catch. An exception from the original (e.g. a bad URL in
 *   `open`) reaches the caller exactly once, and the original is never invoked twice.
 * - A WeakMap `xhr → {url, setNames}` is RESET on every `open()` (a re-opened XHR starts clean).
 * - `setRequestHeader` records the lower-cased name, then calls the original.
 * - `send` adds only the headers the app did not set, through the ORIGINAL setRequestHeader,
 *   each call guarded so an InvalidStateError never escapes.
 * - The prototype is restored only if all three methods are still ours.
 */
import { SDK_BROWSER_XHR_PATCH } from '@nexus/shared/constants';

import { globalState, type XhrMethods } from './global-state';
import { headerSourceFor } from './header-source';

interface XhrRequestState {
  url: string;
  setNames: Set<string>;
}

type AnyMethod = (this: XMLHttpRequest, ...args: unknown[]) => unknown;

/** WHY: idempotent; a no-op without XMLHttpRequest (SSR, workers) or when switched off. */
export function installXhrPatch(): void {
  try {
    if (!SDK_BROWSER_XHR_PATCH) return;
    if (typeof XMLHttpRequest === 'undefined') return;
    const state = globalState();
    if (state.xhrPatch) return;
    const proto = XMLHttpRequest.prototype as unknown as XhrMethods;
    const original: XhrMethods = {
      open: proto.open,
      send: proto.send,
      setRequestHeader: proto.setRequestHeader,
    };
    const patched = createPatchedMethods(original);
    state.xhrPatch = { proto, original, patched };
    proto.open = patched.open;
    proto.setRequestHeader = patched.setRequestHeader;
    proto.send = patched.send;
  } catch {
    // never throw into the host app
  }
}

/** WHY: put the prototype back only when nobody wrapped it after us. */
export function releaseXhrPatchIfOurs(): void {
  try {
    const state = globalState();
    const patch = state.xhrPatch;
    if (!patch) return;
    const { proto, original, patched } = patch;
    const ours =
      proto.open === patched.open &&
      proto.send === patched.send &&
      proto.setRequestHeader === patched.setRequestHeader;
    if (!ours) return;
    proto.open = original.open;
    proto.send = original.send;
    proto.setRequestHeader = original.setRequestHeader;
    state.xhrPatch = null;
  } catch {
    // never throw
  }
}

function createPatchedMethods(original: XhrMethods): XhrMethods {
  const requests = new WeakMap<XMLHttpRequest, XhrRequestState>();
  const originalOpen = original.open as unknown as AnyMethod;
  const originalSetHeader = original.setRequestHeader as unknown as AnyMethod;
  const originalSend = original.send as unknown as AnyMethod;

  function nexusOpen(this: XMLHttpRequest): unknown {
    resetRequest(requests, this);
    // eslint-disable-next-line prefer-rest-params
    const result = originalOpen.apply(this, arguments as unknown as unknown[]);
    trackRequest(requests, this, arguments[1]);
    return result;
  }

  function nexusSetRequestHeader(this: XMLHttpRequest): unknown {
    recordHeader(requests, this, arguments[0]);
    // eslint-disable-next-line prefer-rest-params
    return originalSetHeader.apply(this, arguments as unknown as unknown[]);
  }

  function nexusSend(this: XMLHttpRequest): unknown {
    try {
      decorate(this, requests.get(this), original.setRequestHeader);
    } catch {
      // the request goes out undecorated
    }
    // eslint-disable-next-line prefer-rest-params
    return originalSend.apply(this, arguments as unknown as unknown[]);
  }

  return {
    open: nexusOpen as unknown as XhrMethods['open'],
    setRequestHeader: nexusSetRequestHeader as unknown as XhrMethods['setRequestHeader'],
    send: nexusSend as unknown as XhrMethods['send'],
  };
}

function resetRequest(requests: WeakMap<XMLHttpRequest, XhrRequestState>, xhr: XMLHttpRequest): void {
  try {
    requests.delete(xhr);
  } catch {
    // never throw
  }
}

/** WHY: only after the original `open` succeeded — a failed open leaves the XHR untracked. */
function trackRequest(
  requests: WeakMap<XMLHttpRequest, XhrRequestState>,
  xhr: XMLHttpRequest,
  url: unknown,
): void {
  try {
    requests.set(xhr, { url: String(url), setNames: new Set() });
  } catch {
    // never throw
  }
}

function recordHeader(
  requests: WeakMap<XMLHttpRequest, XhrRequestState>,
  xhr: XMLHttpRequest,
  name: unknown,
): void {
  try {
    requests.get(xhr)?.setNames.add(String(name).toLowerCase());
  } catch {
    // never throw
  }
}

/** WHY: adds only the missing headers; each call guarded (InvalidStateError never escapes). */
function decorate(
  xhr: XMLHttpRequest,
  request: XhrRequestState | undefined,
  setHeader: XhrMethods['setRequestHeader'],
): void {
  if (!request) return;
  const source = headerSourceFor(request.url);
  if (!source) return;
  for (const [name, value] of Object.entries(source.headers())) {
    if (request.setNames.has(name.toLowerCase())) continue;
    try {
      setHeader.call(xhr, name, value);
    } catch {
      // e.g. InvalidStateError
    }
  }
}
