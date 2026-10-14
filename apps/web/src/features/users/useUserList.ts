'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type UserListKeyQuery } from '@/lib/query/keys';

/**
 * WHY: the Users table — ONLY verified identities (sso_cookie / app_attested), most recently seen
 * first, paged by the API's cursor ("Load more"). Filters change the key → a fresh first page,
 * while the previous rows stay on screen until it arrives. Email search is useUserSearch (POST).
 * Chain: api.users.list → ROUTES.users.list → UserController.list → UserService.list →
 * WebEventQueryRepository.listUsers.
 */
export function useUserList(query: UserListKeyQuery, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: qk.users.list(query),
    queryFn: ({ signal, pageParam }) => api.users.list({ ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
