import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

export const metadata: Metadata = { title: 'No access' };

/**
 * PAGES.noAccess() — src/proxy.ts REWRITES here when a signed-in user is not on the dashboard
 * access policy (DASHBOARD_ALLOWED_EMAILS / _DOMAINS). Next ignores the status of an internal
 * rewrite, so this page throws forbidden(): the response is a real HTTP 403 rendering
 * ../forbidden.tsx (experimental.authInterrupts in next.config.ts).
 */
export default function NoAccessPage(): never {
  forbidden();
}
