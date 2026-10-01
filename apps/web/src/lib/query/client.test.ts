import { ERROR_CODES } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../apiError';
import {
  claimSignInReload,
  createQueryClient,
  QUERY_STALE_TIME_MS,
  shouldRetry,
  SIGN_IN_RELOAD_GUARD_MS,
} from './client';

describe('query client', () => {
  it('never retries 4xx, retries other failures twice', () => {
    const notFound = new ApiError(404, ERROR_CODES.NOT_FOUND, 'gone');
    const unavailable = new ApiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'down');
    expect(shouldRetry(0, notFound)).toBe(false);
    expect(shouldRetry(0, unavailable)).toBe(true);
    expect(shouldRetry(1, unavailable)).toBe(true);
    expect(shouldRetry(2, unavailable)).toBe(false);
  });

  it('uses a 60 s stale time and no refetch on window focus', () => {
    const queries = createQueryClient(() => undefined).getDefaultOptions().queries;
    expect(queries?.staleTime).toBe(QUERY_STALE_TIME_MS);
    expect(QUERY_STALE_TIME_MS).toBe(60_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });

  it('calls onUnauthorized for a 401 from any query', async () => {
    const onUnauthorized = vi.fn();
    const client = createQueryClient(onUnauthorized);
    await client
      .fetchQuery({
        queryKey: ['x'],
        queryFn: () => Promise.reject(new ApiError(401, ERROR_CODES.SESSION_EXPIRED, 'expired')),
        retry: false,
      })
      .catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('allows one sign-in reload per guard window', () => {
    const storage = window.sessionStorage;
    storage.clear();
    expect(claimSignInReload(storage, 1_000_000)).toBe(true);
    expect(claimSignInReload(storage, 1_000_000 + SIGN_IN_RELOAD_GUARD_MS - 1)).toBe(false);
    expect(claimSignInReload(storage, 1_000_000 + SIGN_IN_RELOAD_GUARD_MS)).toBe(true);
  });
});
