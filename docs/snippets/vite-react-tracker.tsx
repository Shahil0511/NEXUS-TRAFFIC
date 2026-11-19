/**
 * Data Nexus Traffic — browser tracker for a Vite + React Router app.
 *
 * 1. Vendor the SDK tarball (download it from the integration guide, commit it):
 *      package.json → "dependencies": { "@nexus/react": "file:vendor/nexus-react-1.1.0.tgz" }
 * 2. Set the BUILD-TIME env vars (Vite inlines VITE_* at `vite build`; in Docker pass them as
 *    `ARG` + `ENV` before the build step):
 *      VITE_NEXUS_URL=https://nexus.libas.in/traffic      (no /api)
 *      VITE_NEXUS_KEY=nx_pk_…                             (the PUBLISHABLE key, never nx_sk_)
 *      VITE_NEXUS_ENVIRONMENT=prod                        (optional: prod | staging | dev; localhost is always dev)
 *      VITE_NEXUS_RELEASE=2026.11.18-a1b2c3d              (optional: your build id, ≤ 64 chars)
 *    Unset URL/key → the tracker is a silent no-op (local dev without Nexus).
 * 3. Save docs/snippets/vite-nexus-early.ts as `src/nexus-early.ts`, then in `src/main.tsx` make it
 *    the FIRST import (ES imports are hoisted: anything later runs after your API client loaded)
 *    and render <NexusTracking/> ONCE inside your router (it needs useLocation()):
 *
 *      // src/main.tsx
 *      import './nexus-early';
 *      import { createRoot } from 'react-dom/client';
 *      import { BrowserRouter } from 'react-router-dom';
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
 * What you get: page views (load + route changes) with their route template
 * (`/my-app/stores/:id`), visible time on page, clicks on `data-nexus-tool` elements,
 * `trackTool()` / `trackEvent()` for everything else, retries across page loads, and
 * `X-Nexus-Session` / `X-Nexus-Page-View` on your SAME-ORIGIN fetch and XHR (axios) calls
 * (on by default; `propagateHeadersTo: ['https://api.example.com']` adds another origin, whose
 * CORS must then allow those two headers).
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { trackTool, useNexusTracker, type NexusEnvironment } from '@nexus/react';
import { matchRoutes, useLocation, type RouteObject } from 'react-router-dom';

/** Keep in sync with Vite `base` / the router `basename`, WITHOUT a trailing slash. */
const BASE_PATH = '/my-app';

/**
 * Your route table — the SAME objects you give `createBrowserRouter` / `useRoutes` (or a copy of
 * the `<Route path>` tree). Only `path` and `children` are read.
 */
const ROUTES: RouteObject[] = [
  { path: '/', children: [{ path: 'stores/:storeId' }, { path: 'audits' }, { path: 'docs/*' }] },
];

export function NexusTracking({ userEmail }: { userEmail?: string }) {
  const location = useLocation();
  const { pathname } = location;
  useNexusTracker({
    url: import.meta.env.VITE_NEXUS_URL,
    publishableKey: import.meta.env.VITE_NEXUS_KEY,
    pathname: pathname === '/' ? BASE_PATH : BASE_PATH + pathname,
    routeTemplate: routeTemplate(location),
    environment: nexusEnvironment(import.meta.env.VITE_NEXUS_ENVIRONMENT),
    release: import.meta.env.VITE_NEXUS_RELEASE,
    // Optional: the signed-in user's email (a HINT — Nexus trusts the SSO cookie first).
    user: { email: userEmail },
    // propagateHeadersTo: ['https://api.example.com'], ← other origins (CORS must allow the headers)
  });
  return null;
}

/**
 * `/stores/:storeId` from the matched route branch, with the base path in front. A splat (`*`)
 * becomes `:splat*`. No match → undefined (Nexus then guesses the template itself).
 */
function routeTemplate(location: ReturnType<typeof useLocation>): string | undefined {
  const matches = matchRoutes(ROUTES, location);
  if (!matches) return undefined;
  const segments = matches
    .flatMap((m) => (m.route.path ?? '').split('/'))
    .filter((s) => s !== '')
    .map((s) => (s === '*' ? ':splat*' : s));
  const template = `/${segments.join('/')}`;
  return template === '/' ? BASE_PATH || '/' : BASE_PATH + template;
}

/** An unknown value is ignored (the tracker then uses dev on localhost, else the server default). */
function nexusEnvironment(value: string | undefined): NexusEnvironment | undefined {
  return value === 'prod' || value === 'staging' || value === 'dev' ? value : undefined;
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
