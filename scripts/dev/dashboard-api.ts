/**
 * A tiny client for the Nexus dashboard API, used by the launcher to seed demo data.
 *
 * WHY: the launcher acts as a signed-in ADMIN (its own minted token) and must satisfy the same
 * guards as the real dashboard — the `access_token` cookie and `X-Nexus-Dashboard: 1`. Paths come
 * ONLY from `ROUTES` + `buildPath` (packages/shared), never typed by hand.
 */
import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import { INGEST_HEADERS, type RouteDescriptor } from '@nexus/shared';

import { apiUrl } from './topology';

export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/** The body as JSON, or null when it is empty or not JSON (a proxy error page, say). */
export function parseJsonOrNull(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class DashboardApi {
  constructor(private readonly tokenProvider: () => string) {}

  /** Calls `route` (path already filled with buildPath when it has params) and returns the JSON body. */
  async call<T>(route: RouteDescriptor, path: string = route.path, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Cookie: `${ACCESS_TOKEN_COOKIE}=${this.tokenProvider()}`,
      [INGEST_HEADERS.dashboard]: '1',
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(apiUrl(path), {
      method: route.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = parseJsonOrNull(await res.text());
    if (!res.ok) {
      const envelope = (json ?? {}) as ErrorEnvelope;
      throw new DashboardApiError(
        res.status,
        envelope.error?.code ?? null,
        `${route.method} ${route.path} → ${res.status} ${envelope.error?.message ?? ''}`.trim(),
      );
    }
    return json as T;
  }
}
