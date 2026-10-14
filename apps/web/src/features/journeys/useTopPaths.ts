'use client';

import type { TopPathsQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the most common 3-page sequences ("how do people move through the app?").
 * Chain: api.journeys.topPaths → ROUTES.journeys.topPaths → JourneyController.topPaths →
 * JourneyService.topPaths → WebEventQueryRepository.listTopPaths.
 */
export function useTopPaths(query: TopPathsQuery) {
  return useQuery({
    queryKey: qk.journeys.topPaths(query),
    queryFn: ({ signal }) => api.journeys.topPaths(query, { signal }),
    // A filter change keeps the current rows on screen until the new ones arrive (no flicker).
    placeholderData: keepPreviousData,
  });
}
