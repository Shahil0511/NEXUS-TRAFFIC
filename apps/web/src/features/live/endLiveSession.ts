'use client';

import { toast } from 'sonner';

/** Long enough to read the toast before the page goes away. */
const RELOAD_DELAY_MS = 1500;

/**
 * WHY: when the api ends a live session (`live:session-expired`) or refuses the handshake, the SSO
 * cookie is no longer good. Reloading the page sends the request through src/proxy.ts, which
 * redirects to the portal login with the correct return URL — the same path a signed-out page
 * load takes, so the login URL is built in ONE place (server-side, from PUBLIC_ORIGIN).
 */
export function endLiveSession(): void {
  toast.warning('Your session has ended — taking you to sign in again.');
  window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
}
