'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type SessionListKeyQuery } from '@/lib/query/keys';

/**
 * WHY: the browser sessions table, most recent first (optionally one user's), keyset-paged
 * ("Load more"). React Query owns the cursor (pageParam), the key does not.
 * Chain: api.journeys.sessions → ROUTES.journeys.sessions → JourneyController.sessions →
 * JourneyService.sessions → WebEventQueryRepository.listSessions.
 */
export function useSessionList(query: SessionListKeyQuery) {
  return useInfiniteQuery({
    queryKey: qk.journeys.sessions(query),
    queryFn: ({ signal, pageParam }) =>
      api.journeys.sessions({ ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
