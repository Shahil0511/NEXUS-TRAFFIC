'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type UserTimelineKeyQuery } from '@/lib/query/keys';

/**
 * WHY: a user's combined activity — API calls, page views (with their visible time) and tool uses
 * merged by time, newest first, keyset-paged ("Load more") so rows never repeat while new events
 * arrive. React Query owns the cursor (pageParam), the key does not.
 * Chain: api.users.timeline → ROUTES.users.timeline → UserController.timeline →
 * UserService.timeline → WebEventQueryRepository.listUserTimeline.
 */
export function useUserTimeline(userKey: string, query: UserTimelineKeyQuery) {
  return useInfiniteQuery({
    queryKey: qk.users.timeline(userKey, query),
    queryFn: ({ signal, pageParam }) =>
      api.users.timeline(userKey, { ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
