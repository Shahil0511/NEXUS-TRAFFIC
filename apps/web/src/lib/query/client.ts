/**
 * The one React Query client configuration of the dashboard.
 *
 * WHY THESE DEFAULTS
 * - staleTime 60 s: analytics over minutes/days do not change meaningfully faster; switching
 *   pages and back must not refetch everything (live data arrives over Socket.io in S4).
 * - refetchOnWindowFocus off: an internal dashboard is often left open in a tab.
 * - NO retry on 4xx: a validation error, a 403 or an expired session cannot heal by retrying.
 *   Other failures (5xx, network) retry twice.
 * - A 401 anywhere means the SSO session ended → reload, so the proxy redirects to the portal.
 *
 * Created with `useState(createQueryClient)` in AppProviders so every browser tab (and every test)
 * gets its own client.
 */
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from '../apiError';

export const QUERY_STALE_TIME_MS = 60_000;
const MAX_RETRIES = 2;

/** Retry policy: never for client errors, at most MAX_RETRIES otherwise. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

/** At most one sign-in reload per window: protects against a reload loop. */
export const SIGN_IN_RELOAD_GUARD_MS = 30_000;
const SIGN_IN_RELOAD_KEY = 'nexus-traffic:sign-in-reload-at';

/**
 * Whether a sign-in reload may happen now (and remember that it did). If the proxy lets a page
 * through but the API still answers 401 (e.g. web and api env disagree), reloading again would
 * loop forever — the second 401 inside the guard window shows the error state instead.
 */
export function claimSignInReload(storage: Storage | undefined, nowMs: number): boolean {
  try {
    const last = Number(storage?.getItem(SIGN_IN_RELOAD_KEY) ?? 0);
    if (nowMs - last < SIGN_IN_RELOAD_GUARD_MS) return false;
    storage?.setItem(SIGN_IN_RELOAD_KEY, String(nowMs));
  } catch {
    // Storage blocked: reloading once per page load is still bounded by the proxy redirect.
  }
  return true;
}

/** WHY separate: the reload is a side effect tests replace with a spy. */
export function reloadForSignIn(): void {
  if (claimSignInReload(window.sessionStorage, Date.now())) window.location.reload();
}

function handleGlobalError(error: unknown, onUnauthorized: () => void): void {
  if (error instanceof ApiError && error.isUnauthorized) onUnauthorized();
}

export function createQueryClient(onUnauthorized: () => void = reloadForSignIn): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => handleGlobalError(error, onUnauthorized) }),
    mutationCache: new MutationCache({
      onError: (error) => handleGlobalError(error, onUnauthorized),
    }),
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: { retry: false },
    },
  });
}
