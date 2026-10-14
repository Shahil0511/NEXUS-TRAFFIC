'use client';

import type { PageListQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: time on page per path template — views, sessions, avg/p50 VISIBLE time (tab in the
 * foreground) and exits, most viewed first.
 * Chain: api.pages.list → ROUTES.pages.list → PageController.list → PageService.list →
 * WebEventQueryRepository.listPageStats.
 */
export function usePageStats(query: PageListQuery) {
  return useQuery({
    queryKey: qk.pages.list(query),
    queryFn: ({ signal }) => api.pages.list(query, { signal }),
    // A filter change keeps the current rows on screen until the new ones arrive (no flicker).
    placeholderData: keepPreviousData,
  });
}
