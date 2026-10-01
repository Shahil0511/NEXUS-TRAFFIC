'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk, type EndpointListKeyQuery } from '@/lib/query/keys';

/**
 * WHY: the API Routes table — one row per (app, method, route template), sorted SERVER-side by a
 * whitelisted key (ENDPOINT_SORT_VALUES), paged by the API's offset cursor ("Load more").
 * Changing sort/search/filters changes the key → a fresh first page.
 * Chain: api.endpoints.list → ROUTES.endpoints.list → EndpointController.list →
 * EndpointService.list → ApiRequestQueryRepository.listEndpointStats.
 */
export function useEndpointStats(query: EndpointListKeyQuery) {
  return useInfiniteQuery({
    queryKey: qk.endpoints.list(query),
    queryFn: ({ signal, pageParam }) =>
      api.endpoints.list({ ...query, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
