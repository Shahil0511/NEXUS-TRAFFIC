'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type UserSearchKeyBody } from '@/lib/query/keys';

/**
 * WHY: users whose verified email contains the typed text — the Users page search box and the
 * command palette. The text goes in a POST BODY, never in a URL (ADR 0006), and lives only in
 * React state and this in-memory cache key. Disabled for an empty search (use useUserList).
 * Chain: api.users.search → ROUTES.users.search → UserController.search → UserService.search →
 * WebEventQueryRepository.listUsers.
 */
export function useUserSearch(body: UserSearchKeyBody, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: qk.users.search(body),
    queryFn: ({ signal, pageParam }) =>
      api.users.search({ ...body, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: (options.enabled ?? true) && body.search.trim() !== '',
    placeholderData: keepPreviousData,
  });
}
