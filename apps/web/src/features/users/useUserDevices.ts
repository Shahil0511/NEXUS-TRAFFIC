'use client';

import type { UserDevicesQuery } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the (device type, browser, OS) combinations a person used in the window — the Devices tab
 * only (mounted while it is open). Empty, never a 404, when the person did nothing in the window.
 * Chain: api.users.devices → ROUTES.users.devices → UserController.devices →
 * UserService.devices → WebEventQueryRepository.listUserDevices.
 */
export function useUserDevices(userKey: string, query: UserDevicesQuery) {
  return useQuery({
    queryKey: qk.users.devices(userKey, query),
    queryFn: ({ signal }) => api.users.devices(userKey, query, { signal }),
  });
}
