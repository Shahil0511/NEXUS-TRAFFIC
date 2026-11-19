/**
 * @nexus/react/early — install header propagation BEFORE the app's first API call (ADR 0011).
 *
 * WHY: the tracker mounts in a React effect, after hydration. API calls made earlier (a data
 * client created at module load, the first openapi-fetch request) would carry no
 * `X-Nexus-Session`, so the backend could not link them to the page view. This entry patches
 * `fetch` and `XMLHttpRequest` right away; the tracker later adopts the same session and the
 * pre-allocated page-view id.
 *
 * - Next ≥ 15.3: call it from `src/instrumentation-client.ts`.
 * - Vite / CRA: ESM imports are hoisted, so put the call in an app-local `nexus-early.ts` and make
 *   `import './nexus-early';` the FIRST import of `main.tsx`.
 *
 * It is EXPLICIT (no side effect on import, `sideEffects: false`), never throws, and imports no
 * react, no tracker and no network code — only URL helpers and the cached remote config.
 */
import { cachedBlocksPropagation, readCachedConfig } from './core/config-cache';
import { installFetchPatch } from './core/fetch-patch';
import {
  captureNativeFetch,
  globalState,
  sharedSessionStore,
  type NexusGlobalState,
} from './core/global-state';
import { createHeaderSource } from './core/header-source';
import { ingestExcludeUrls } from './core/ingest-urls';
import { keyScope } from './core/sdk-info';
import { createUuid } from './core/uuid';
import { installXhrPatch } from './core/xhr-patch';

export interface NexusEarlyOptions {
  /** NEXUS_URL without `/api` (`process.env.X` may be undefined — then this is a no-op). */
  url: string | undefined;
  /** The PUBLISHABLE key — REQUIRED, so the install has a key scope the kill switch can stop. */
  publishableKey: string | undefined;
  /** Default true. false → nothing is installed. */
  propagateHeaders?: boolean;
  /** Extra EXACT origins that also get the headers (their CORS must allow them). */
  propagateHeadersTo?: readonly string[];
  /** Turn it off (e.g. for internal test accounts). */
  disabled?: boolean;
}

/**
 * Patch `fetch` / `XMLHttpRequest` now. A no-op without a non-empty url and key, outside a
 * browser, when disabled, or when the cached remote config says this key is killed or has
 * `header_propagation` switched off. Idempotent. NEVER throws.
 */
export function installNexusEarly(options: NexusEarlyOptions): void {
  try {
    const { url, publishableKey } = options;
    if (!isNonEmpty(url) || !isNonEmpty(publishableKey)) return;
    if (options.disabled || options.propagateHeaders === false) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const scope = keyScope(publishableKey);
    const state = globalState();
    if (state.earlySource || state.disabledKeys.has(scope)) return;
    if (cachedBlocksPropagation(readCachedConfig(scope))) return;

    captureNativeFetch();
    state.pendingPageViewId ??= createUuid();
    const source = createHeaderSource({
      keyScope: scope,
      excludeUrls: ingestExcludeUrls(url),
      allowOrigins: options.propagateHeadersTo ?? [],
      pageView: () => state.active?.currentView() ?? pendingView(state),
    });
    state.earlySource = source;
    state.headerSources.add(source);
    installFetchPatch();
    installXhrPatch();
  } catch {
    // never throw into the host app
  }
}

/** WHY: before the tracker's first page view, the pre-allocated id stands for it. */
function pendingView(state: NexusGlobalState): { id: string; sessionId: string } | null {
  const id = state.pendingPageViewId;
  if (!id) return null;
  return { id, sessionId: sharedSessionStore().peekCurrent(Date.now()) };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
