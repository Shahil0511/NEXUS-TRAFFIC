import type { Metadata } from 'next';

import { loadWebEnv, type WebEnv } from '@/env.schema';
import { dashboardAccessOf } from '@/features/integration/dashboardAccessCheck';
import { IntegrationView } from '@/features/integration/IntegrationView';

export const metadata: Metadata = { title: 'Data health' };

/**
 * The web server's env, or null when it is incomplete (the access check then says "unknown").
 * WHY it is the RUNTIME env: the root layout (app/layout.tsx) awaits headers(), a request-time
 * API, so every page renders per request (dynamic rendering) and process.env is read when the
 * page is served, not frozen at `next build` (node_modules/next/dist/docs/01-app/02-guides/
 * environment-variables.md, "Runtime Environment Variables"). Changing DASHBOARD_* and restarting
 * web is enough.
 */
function readWebEnv(): WebEnv | null {
  try {
    return loadWebEnv();
  } catch {
    return null;
  }
}

/**
 * PAGES.integration() — ONLY the access enum crosses to the client, never an email or a domain.
 * @see ../../../features/integration/IntegrationView.tsx
 * @see ../../../features/integration/dashboardAccessCheck.ts
 */
export default function IntegrationPage() {
  return <IntegrationView dashboardAccess={dashboardAccessOf(readWebEnv())} />;
}
