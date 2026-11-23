'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type AccessLogKeyQuery } from '@/lib/query/keys';

/**
 * WHY: the person access log, newest first, keyset-paged ("Load more"). React Query owns the
 * cursor (pageParam), the key does not. Used ONLY under PrivacyView's admin check, so a non-admin
 * never sends the request.
 * Chain: api.privacy.accessLog → ROUTES.privacy.accessLog → PrivacyController.accessLog →
 * PrivacyService.accessLog → PersonAccessLogRepository.list.
 */
export function useAccessLog(query: AccessLogKeyQuery) {
  return useInfiniteQuery({
    queryKey: qk.privacy.accessLog(query),
    queryFn: ({ signal, pageParam }) =>
      api.privacy.accessLog({ ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
