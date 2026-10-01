'use client';

import type { OverviewSummaryQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the Overview KPI cards (requests, error rate, p95, page views, users, active now).
 * Chain: api.overview.summary → ROUTES.overview.summary → OverviewController.summary →
 * OverviewService.summary (apps/api/src/services/overview.service.ts).
 */
export function useOverviewSummary(query: OverviewSummaryQuery) {
  return useQuery({
    queryKey: qk.overview.summary(query),
    queryFn: ({ signal }) => api.overview.summary(query, { signal }),
  });
}
