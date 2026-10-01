'use client';

import type { OverviewTimeseriesQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the Overview charts (traffic, errors by class, p95), one bucket per grain of the window.
 * Chain: api.overview.timeseries → ROUTES.overview.timeseries → OverviewController.timeseries →
 * OverviewService.timeseries (apps/api/src/services/overview.service.ts).
 */
export function useOverviewTimeseries(query: OverviewTimeseriesQuery) {
  return useQuery({
    queryKey: qk.overview.timeseries(query),
    queryFn: ({ signal }) => api.overview.timeseries(query, { signal }),
  });
}
