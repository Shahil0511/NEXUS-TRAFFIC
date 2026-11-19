/**
 * `useNexusTracker` — the React entry point of the Data Nexus Traffic browser tracker.
 *
 * WHY: one hook call in the app's root layout gives page views, time on page, tool use
 * (`data-nexus-tool` clicks), header propagation (same-origin fetch + XHR), retries across page
 * loads and the remote kill switch, following the browser contract
 * (docs/integration/03-browser-contract.md). It is a NO-OP on the server, when `url` or
 * `publishableKey` is missing (local dev without Nexus) and when `disabled` is true.
 */
import { useEffect, useRef } from 'react';

import type { BrowserTracker } from './core/browser-tracker';
import type { NexusEnvironment } from './core/environment';
import { globalState } from './core/global-state';
import { resolveIngestUrl } from './core/ingest-urls';
import { acquireTracker } from './core/registry';
import type { TrackOptions } from './core/sanitize';

export interface UseNexusTrackerOptions {
  /** NEXUS_URL without `/api`, e.g. `https://nexus.libas.in/traffic`. Missing → tracker disabled. */
  url: string | undefined | null;
  /** The PUBLISHABLE key `nx_pk_…` — NEVER the secret key. Missing → tracker disabled. */
  publishableKey: string | undefined | null;
  /**
   * The current path INCLUDING the app's base path, without query/hash, e.g. `/my-app/audits`.
   * Next's `usePathname()` and react-router's `useLocation().pathname` EXCLUDE the base path —
   * prepend it (the `@nexus/react/next` adapter does this for you). `null`/`undefined` → no
   * page view yet.
   */
  pathname: string | undefined | null;
  /**
   * The route pattern of the current page INCLUDING the base path, e.g. `/my-app/stores/:id`.
   * Stamped on every event of the page view. Omit it when unsure — the collector then guesses.
   * `<NexusTracker/>` derives it from `useParams()`.
   */
  routeTemplate?: string | null;
  /** The signed-in user — a HINT only; the collector trusts the SSO cookie over it. */
  user?: { email?: string | null } | null;
  /** `prod` | `staging` | `dev`. Default: `dev` on localhost, otherwise the server default (`prod`). */
  environment?: NexusEnvironment;
  /** Your frontend build, e.g. `2026.11.18-a1b2c3d` (≤ 64 chars). */
  release?: string;
  /**
   * Add `X-Nexus-Session` / `X-Nexus-Page-View` to the app's SAME-ORIGIN `fetch` and XHR calls so
   * the backend SDK can link API requests to page views. Default true.
   */
  propagateHeaders?: boolean;
  /**
   * Extra EXACT origins (e.g. `https://api.example.com`) that also get the headers. Their CORS
   * config must allow `X-Nexus-Session` and `X-Nexus-Page-View`, or the browser blocks the call.
   */
  propagateHeadersTo?: readonly string[];
  /** Ask Nexus for module switches and the kill switch. Default true. */
  remoteConfig?: boolean;
  /** Keep failed batches in localStorage and retry them on the next page load. Default true. */
  persistRetries?: boolean;
  /** Record clicks on `[data-nexus-tool]` elements. Default true. */
  autoTools?: boolean;
  /** Turn the tracker off (e.g. for internal test accounts). */
  disabled?: boolean;
}

/** WHY: mounts (or reuses) the tracker and keeps its user and path in sync with React state. */
export function useNexusTracker(options: UseNexusTrackerOptions): void {
  const { url, publishableKey, pathname } = options;
  const routeTemplate = options.routeTemplate ?? undefined;
  const propagateHeaders = options.propagateHeaders ?? true;
  const autoTools = options.autoTools ?? true;
  const remoteConfig = options.remoteConfig ?? true;
  const persistRetries = options.persistRetries ?? true;
  const environment = options.environment;
  const release = options.release;
  // A stable dependency for an array prop (callers often pass a new literal every render).
  const propagateHeadersTo = originsKey(options.propagateHeadersTo);
  const enabled = Boolean(url && publishableKey && !options.disabled) && isBrowser();
  const email = options.user?.email ?? undefined;
  const trackerRef = useRef<BrowserTracker | null>(null);
  const configDeps = [
    enabled,
    url,
    publishableKey,
    autoTools,
    propagateHeaders,
    environment,
    release,
    propagateHeadersTo,
    remoteConfig,
    persistRetries,
  ];

  // 1. Lifecycle: acquire on mount / config change, release on unmount.
  useEffect(() => {
    if (!enabled || !url || !publishableKey) return undefined;
    try {
      const { tracker, release: releaseTracker } = acquireTracker({
        url,
        ingestUrl: resolveIngestUrl(url),
        publishableKey,
        autoTools,
        propagateHeaders,
        propagateHeadersTo: propagateHeadersTo ? propagateHeadersTo.split(',') : [],
        environment,
        release,
        remoteConfig,
        persistRetries,
      });
      trackerRef.current = tracker;
      return () => {
        trackerRef.current = null;
        releaseTracker();
      };
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, configDeps);

  // 2. User hint (before the path effect, so the first page view already carries it).
  useEffect(() => {
    trackerRef.current?.setUser(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...configDeps, email]);

  // 3. Path → page views (the template travels with its path).
  useEffect(() => {
    if (pathname) trackerRef.current?.setPath(pathname, routeTemplate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...configDeps, pathname, routeTemplate]);
}

/**
 * Record a use of a feature, e.g. `trackTool('audits.export-csv', { action: 'export', value: 120 })`.
 *
 * WHY: for anything `data-nexus-tool` cannot express (keyboard shortcuts, async results). Goes to
 * the active tracker; a no-op when none is mounted or the name is invalid. NEVER throws.
 */
export function trackTool(tool: string, options?: TrackOptions): void {
  try {
    globalState().active?.trackTool(tool, options);
  } catch {
    // never throw into the host app
  }
}

/**
 * Record a custom event, e.g. `trackEvent('report.generated', { value: 3 })`.
 *
 * WHY: business events that are not a UI tool. Same naming rule as tools. NEVER throws.
 */
export function trackEvent(name: string, options?: Omit<TrackOptions, 'action'>): void {
  try {
    globalState().active?.trackEvent(name, options);
  } catch {
    // never throw into the host app
  }
}

/** WHY: flush queued events now (e.g. right before a programmatic full-page redirect). */
export function flushNexus(): void {
  try {
    globalState().active?.flush();
  } catch {
    // never throw into the host app
  }
}

/**
 * WHY: runs during render, so it must never throw — an untyped (JS) caller may pass a string
 * straight from an env var. Anything that is not an array of strings counts as "no extra origins".
 */
function originsKey(origins: unknown): string {
  if (!Array.isArray(origins)) return '';
  return origins.filter((origin): origin is string => typeof origin === 'string' && origin !== '').join(',');
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
