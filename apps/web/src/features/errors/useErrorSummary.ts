'use client';

import type { ErrorSummaryQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: error totals, the 4xx/5xx chart, the status breakdown and the top failing endpoints
 * (also reused by the Overview's "Top failing endpoints" panel — same key, one request).
 * Chain: api.errors.summary → ROUTES.errors.summary → ErrorController.summary →
 * ErrorService.summary (apps/api/src/services/error.service.ts).
 */
export function useErrorSummary(query: ErrorSummaryQuery) {
  return useQuery({
    queryKey: qk.errors.summary(query),
    queryFn: ({ signal }) => api.errors.summary(query, { signal }),
    // A filter change keeps the current rows on screen until the new ones arrive (no flicker).
    placeholderData: keepPreviousData,
  });
}
