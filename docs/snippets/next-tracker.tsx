'use client';
/**
 * Data Nexus Traffic — browser tracker for a Next.js App Router app.
 *
 * 1. Vendor the SDK tarball (download it from the integration guide, commit it):
 *      package.json → "dependencies": { "@nexus/react": "file:vendor/nexus-react-1.1.0.tgz" }
 * 2. Set the BUILD-TIME env vars (NEXT_PUBLIC_* are inlined by `next build`; in Docker pass them
 *    as `ARG` + `ENV` before the build step):
 *      NEXT_PUBLIC_NEXUS_URL=https://nexus.libas.in/traffic      (no /api)
 *      NEXT_PUBLIC_NEXUS_KEY=nx_pk_…                             (the PUBLISHABLE key, never nx_sk_)
 *      NEXT_PUBLIC_NEXUS_ENVIRONMENT=prod                        (optional: prod | staging | dev;
 *                                                                 localhost is always dev)
 *      NEXT_PUBLIC_NEXUS_RELEASE=2026.11.18-a1b2c3d              (optional: your build id, ≤ 64 chars)
 *    Unset URL/key → the tracker is a silent no-op (local dev without Nexus).
 * 3. Save this file as `app/providers.tsx` and wrap your root layout with it:
 *
 *      // app/layout.tsx (a server component)
 *      import { Providers } from './providers';
 *      export default function RootLayout({ children }: { children: React.ReactNode }) {
 *        return (<html lang="en"><body><Providers>{children}</Providers></body></html>);
 *      }
 *
 * 4. Optional, recommended: also save docs/snippets/next-instrumentation-client.ts as
 *    `src/instrumentation-client.ts` so API calls made BEFORE hydration carry the session headers.
 *
 * BASE PATH: Next's `usePathname()` EXCLUDES `next.config` `basePath`, but every path Nexus
 * receives must start with it — so pass the SAME value as `basePath` below.
 *
 * What you get: page views (load + client-side route changes) with their route template
 * (`/my-app/stores/:id`, from useParams()), visible time on page, clicks on `data-nexus-tool`
 * elements, `trackTool()` / `trackEvent()` for everything else, retries across page loads, and
 * `X-Nexus-Session` / `X-Nexus-Page-View` on your SAME-ORIGIN fetch and XHR calls (on by default;
 * `propagateHeaders={false}` turns it off, `propagateHeadersTo={['https://api.example.com']}` adds
 * another origin — whose CORS must then allow those two headers).
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { NexusTracker, trackTool, type NexusEnvironment } from '@nexus/react/next';
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
          // Keep process.env.NEXT_PUBLIC_* literal: Next only inlines a literal property access.
          environment={nexusEnvironment(process.env.NEXT_PUBLIC_NEXUS_ENVIRONMENT)}
          release={process.env.NEXT_PUBLIC_NEXUS_RELEASE}
          // propagateHeadersTo={['https://api.example.com']}  ← other origins (CORS must allow the headers)
        />
      </Suspense>
      {children}
    </>
  );
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
