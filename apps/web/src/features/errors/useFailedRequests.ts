'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type ErrorListKeyQuery } from '@/lib/query/keys';

/**
 * WHY: the failed-request list, newest first, paged by the API's keyset cursor
 * (occurred_at, event_id) — "Load more" fetches the page after the last row, so rows never repeat
 * or skip while new failures arrive. React Query owns the cursor (pageParam), the key does not.
 * Chain: api.errors.list → ROUTES.errors.list → ErrorController.list → ErrorService.list
 * (apps/api/src/services/error.service.ts).
 */
export function useFailedRequests(query: ErrorListKeyQuery) {
  return useInfiniteQuery({
    queryKey: qk.errors.list(query),
    queryFn: ({ signal, pageParam }) =>
      api.errors.list({ ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
