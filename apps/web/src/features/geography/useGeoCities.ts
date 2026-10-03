'use client';

import type { GeoQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the same counts per city — APPROXIMATE (GeoLite2 city centroids), labelled so in the UI.
 * Chain: api.geo.cities → ROUTES.geo.cities → GeoController.cities → GeoService.cities →
 * WebEventQueryRepository.listCities.
 */
export function useGeoCities(query: GeoQuery) {
  return useQuery({
    queryKey: qk.geo.cities(query),
    queryFn: ({ signal }) => api.geo.cities(query, { signal }),
  });
}
