'use client';

import type { DevicesOverviewQuery } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: new versus returning devices (the tracker's anonymous device id) for the audience panel.
 * Chain: api.overview.devices → ROUTES.overview.devices → OverviewController.devices →
 * OverviewService.devices → WebEventQueryRepository.countDeviceReturn.
 */
export function useDeviceReturn(query: DevicesOverviewQuery) {
  return useQuery({
    queryKey: qk.overview.devices(query),
    queryFn: ({ signal }) => api.overview.devices(query, { signal }),
    placeholderData: keepPreviousData,
  });
}
