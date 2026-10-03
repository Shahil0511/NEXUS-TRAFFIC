'use client';

import type { GeoQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: requests, page views and verified users per country (GeoLite2, null = unknown/private IP).
 * Chain: api.geo.countries → ROUTES.geo.countries → GeoController.countries →
 * GeoService.countries → WebEventQueryRepository.listCountries.
 */
export function useGeoCountries(query: GeoQuery) {
  return useQuery({
    queryKey: qk.geo.countries(query),
    queryFn: ({ signal }) => api.geo.countries(query, { signal }),
  });
}
