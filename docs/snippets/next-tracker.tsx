'use client';
/**
 * Data Nexus Traffic — browser tracker for a Next.js App Router app.
 *
 * 1. Vendor the SDK tarball (download it from the integration guide, commit it):
 *      package.json → "dependencies": { "@nexus/react": "file:vendor/nexus-react-1.0.0.tgz" }
 * 2. Set the BUILD-TIME env vars (NEXT_PUBLIC_* are inlined by `next build`; in Docker pass them
 *    as `ARG` + `ENV` before the build step):
 *      NEXT_PUBLIC_NEXUS_URL=https://nexus.libas.in/traffic      (no /api)
 *      NEXT_PUBLIC_NEXUS_KEY=nx_pk_…                             (the PUBLISHABLE key, never nx_sk_)
 *    Unset → the tracker is a silent no-op (local dev without Nexus).
 * 3. Save this file as `app/providers.tsx` and wrap your root layout with it:
 *
 *      // app/layout.tsx (a server component)
 *      import { Providers } from './providers';
 *      export default function RootLayout({ children }: { children: React.ReactNode }) {
 *        return (<html lang="en"><body><Providers>{children}</Providers></body></html>);
 *      }
 *
 * BASE PATH: Next's `usePathname()` EXCLUDES `next.config` `basePath`, but every path Nexus
 * receives must start with it — so pass the SAME value as `basePath` below.
 *
 * What you get: page views (load + client-side route changes), visible time on page, clicks on
 * `data-nexus-tool` elements, and `trackTool()` / `trackEvent()` for everything else.
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { NexusTracker, trackTool } from '@nexus/react/next';
import { Suspense, type ReactNode } from 'react';

/** Keep in sync with `basePath` in next.config.(js|ts). */
const BASE_PATH = '/my-app';

export function Providers({
  children,
  userEmail,
}: {
  children: ReactNode;
  /** Optional: the signed-in user's email (a HINT — Nexus trusts the SSO cookie first). */
  userEmail?: string;
}) {
  return (
    <>
      {/* usePathname() inside a layout needs a Suspense boundary (static rendering bail-out). */}
      <Suspense fallback={null}>
        <NexusTracker
          url={process.env.NEXT_PUBLIC_NEXUS_URL}
          publishableKey={process.env.NEXT_PUBLIC_NEXUS_KEY}
          basePath={BASE_PATH}
          user={{ email: userEmail }}
          // propagateHeaders  ← opt-in: adds X-Nexus-Session / X-Nexus-Page-View to same-origin fetches
        />
      </Suspense>
      {children}
    </>
  );
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
