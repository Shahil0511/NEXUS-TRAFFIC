'use client';

import type { EndpointDetailQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: one route's stats, chart, status breakdown and slowest calls, by its OPAQUE endpointId
 * (uuid v5 stored at ingest — the route template itself never appears in a URL).
 * Chain: api.endpoints.detail → ROUTES.endpoints.detail → EndpointController.detail →
 * EndpointService.detail → ApiRequestQueryRepository.getEndpointDetail.
 */
export function useEndpointDetail(endpointId: string, query: EndpointDetailQuery) {
  return useQuery({
    queryKey: qk.endpoints.detail(endpointId, query),
    queryFn: ({ signal }) => api.endpoints.detail(endpointId, query, { signal }),
  });
}
