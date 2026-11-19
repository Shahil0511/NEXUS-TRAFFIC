'use client';

import type { BreakdownOverviewQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the top values of ONE dimension (browser, OS, time zone, release, environment …) for the
 * breakdown panels. Keeps the previous list while a new dimension or range loads.
 * Chain: api.overview.breakdown → ROUTES.overview.breakdown → OverviewController.breakdown →
 * OverviewService.breakdown → WebEventQueryRepository.countByDimension (browser) /
 * ApiRequestQueryRepository.countByDimension (server).
 */
export function useBreakdown(query: BreakdownOverviewQuery) {
  return useQuery({
    queryKey: qk.overview.breakdown(query),
    queryFn: ({ signal }) => api.overview.breakdown(query, { signal }),
    placeholderData: keepPreviousData,
  });
}
