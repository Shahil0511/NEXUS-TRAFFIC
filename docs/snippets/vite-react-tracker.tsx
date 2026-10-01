/**
 * Data Nexus Traffic — browser tracker for a Vite + React Router app.
 *
 * 1. Vendor the SDK tarball (download it from the integration guide, commit it):
 *      package.json → "dependencies": { "@nexus/react": "file:vendor/nexus-react-1.0.0.tgz" }
 * 2. Set the BUILD-TIME env vars (Vite inlines VITE_* at `vite build`; in Docker pass them as
 *    `ARG` + `ENV` before the build step):
 *      VITE_NEXUS_URL=https://nexus.libas.in/traffic      (no /api)
 *      VITE_NEXUS_KEY=nx_pk_…                             (the PUBLISHABLE key, never nx_sk_)
 *    Unset → the tracker is a silent no-op (local dev without Nexus).
 * 3. Render <NexusTracking/> ONCE inside your <BrowserRouter> (it needs useLocation()):
 *
 *      createRoot(document.getElementById('root')!).render(
 *        <BrowserRouter basename={BASE_PATH}>
 *          <NexusTracking />
 *          <App />
 *        </BrowserRouter>,
 *      );
 *
 * BASE PATH: `useLocation().pathname` EXCLUDES the router `basename` (and Vite's `base`), but
 * every path Nexus receives must start with your app's base path — so prepend it.
 *
 * What you get: page views (load + route changes), visible time on page, clicks on
 * `data-nexus-tool` elements, and `trackTool()` / `trackEvent()` for everything else.
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { trackTool, useNexusTracker } from '@nexus/react';
import { useLocation } from 'react-router-dom';

/** Keep in sync with Vite `base` / the router `basename`, WITHOUT a trailing slash. */
const BASE_PATH = '/my-app';

export function NexusTracking({ userEmail }: { userEmail?: string }) {
  const { pathname } = useLocation();
  useNexusTracker({
    url: import.meta.env.VITE_NEXUS_URL,
    publishableKey: import.meta.env.VITE_NEXUS_KEY,
    pathname: pathname === '/' ? BASE_PATH : BASE_PATH + pathname,
    // Optional: the signed-in user's email (a HINT — Nexus trusts the SSO cookie first).
    user: { email: userEmail },
    // propagateHeaders: true, ← opt-in: adds X-Nexus-Session / X-Nexus-Page-View to same-origin fetches
  });
  return null;
}

/**
 * Tool tracking, two ways.
 * - Markup: `data-nexus-tool` (lower-case, dotted id) is recorded on click — no code needed.
 *   `data-nexus-action` / `data-nexus-label` are optional; the label must be STATIC UI text.
 * - Code: `trackTool()` for things a click attribute cannot express (results, shortcuts…).
 */
export function ExportButton({ onExport }: { onExport: () => Promise<number> }) {
  return (
    <button
      type="button"
      data-nexus-tool="audits.export-csv"
      data-nexus-action="export"
      data-nexus-label="Export CSV"
      onClick={async () => {
        const rows = await onExport();
        // A follow-up event with a value that matters (never user-typed text, never PII).
        trackTool('audits.export-csv.done', { action: 'export', value: rows });
      }}
    >
      Export CSV
    </button>
  );
}
