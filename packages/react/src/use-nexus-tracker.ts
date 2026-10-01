/**
 * `useNexusTracker` — the React entry point of the Data Nexus Traffic browser tracker.
 *
 * WHY: one hook call in the app's root layout gives page views, time on page, tool use
 * (`data-nexus-tool` clicks) and optional header propagation, following the browser contract
 * (docs/integration/03-browser-contract.md). It is a NO-OP on the server, when `url` or
 * `publishableKey` is missing (local dev without Nexus) and when `disabled` is true.
 */
import { useEffect, useRef } from 'react';

import type { BrowserTracker } from './core/browser-tracker';
import { globalState } from './core/global-state';
import { acquireTracker, resolveIngestUrl } from './core/registry';
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
  /** The signed-in user — a HINT only; the collector trusts the SSO cookie over it. */
  user?: { email?: string | null } | null;
  /**
   * Add `X-Nexus-Session` / `X-Nexus-Page-View` to SAME-ORIGIN `fetch` calls so the backend SDK
   * can link API requests to page views. Your API's CORS `allowedHeaders` must permit them if the
   * API is on a different origin (it is skipped for other origins anyway). Default false.
   */
  propagateHeaders?: boolean;
  /** Record clicks on `[data-nexus-tool]` elements. Default true. */
  autoTools?: boolean;
  /** Turn the tracker off (e.g. for internal test accounts). */
  disabled?: boolean;
}

/** WHY: mounts (or reuses) the tracker and keeps its user and path in sync with React state. */
export function useNexusTracker(options: UseNexusTrackerOptions): void {
  const { url, publishableKey, pathname } = options;
  const propagateHeaders = options.propagateHeaders ?? false;
  const autoTools = options.autoTools ?? true;
  const enabled = Boolean(url && publishableKey && !options.disabled) && isBrowser();
  const email = options.user?.email ?? undefined;
  const trackerRef = useRef<BrowserTracker | null>(null);

  // 1. Lifecycle: acquire on mount / config change, release on unmount.
  useEffect(() => {
    if (!enabled || !url || !publishableKey) return undefined;
    try {
      const { tracker, release } = acquireTracker({
        ingestUrl: resolveIngestUrl(url),
        publishableKey,
        autoTools,
        propagateHeaders,
      });
      trackerRef.current = tracker;
      return () => {
        trackerRef.current = null;
        release();
      };
    } catch {
      return undefined;
    }
  }, [enabled, url, publishableKey, autoTools, propagateHeaders]);

  // 2. User hint (before the path effect, so the first page view already carries it).
  useEffect(() => {
    trackerRef.current?.setUser(email);
  }, [enabled, url, publishableKey, autoTools, propagateHeaders, email]);

  // 3. Path → page views.
  useEffect(() => {
    if (pathname) trackerRef.current?.setPath(pathname);
  }, [enabled, url, publishableKey, autoTools, propagateHeaders, pathname]);
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

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
