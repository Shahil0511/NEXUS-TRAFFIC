'use client';

import type { OverviewAppsQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one row per registered app — traffic, error rate, p95, page views, users and sessions with
 * deltas — for the Applications page, the Overview's apps panel and an app's own page (`app` set).
 * Keeps the previous rows while a new range loads, so the table never blanks.
 * Chain: api.overview.apps → ROUTES.overview.apps → OverviewController.apps →
 * OverviewService.apps → ApiRequestQueryRepository.summarizeTrafficByApp +
 * WebEventQueryRepository.summarizeActivityByApp.
 */
export function useAppTraffic(query: OverviewAppsQuery) {
  return useQuery({
    queryKey: qk.overview.apps(query),
    queryFn: ({ signal }) => api.overview.apps(query, { signal }),
    placeholderData: keepPreviousData,
  });
}
