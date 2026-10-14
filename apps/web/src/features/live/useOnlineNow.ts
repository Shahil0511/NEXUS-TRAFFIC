'use client';

import type { LiveOnlineQuery, OnlineNowDto } from '@nexus/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { qk } from '@/lib/query/keys';

/**
 * How often "who is online" is asked again. The window itself is ACTIVE_USER_WINDOW_MS (5 min);
 * 15 s keeps "active N s ago" honest without turning every open tab into a load generator.
 */
export const ONLINE_NOW_REFRESH_MS = 15_000;

/**
 * WHY: "who is using which app right now, and doing what" — the Live page's Who's online panel,
 * the Applications "Online now" column, an app's "N online now" link and a user's "Online now"
 * badge all read this ONE query (same key → one request per scope). It polls every
 * ONLINE_NOW_REFRESH_MS while the tab is visible only (a hidden tab does not poll), and keeps the
 * previous answer on screen while the next one loads, so rows never blink.
 * The `live` group is NOT refreshed by socket traffic (autoRefreshPolicy), hence the polling.
 * Chain: api.live.online → ROUTES.live.online → LiveController.online →
 * LiveService.online → WebEventQueryRepository.countOnlineByApp +
 * WebEventQueryRepository.listOnlineUsers.
 */
export function useOnlineNow(query: LiveOnlineQuery) {
  return useQuery<OnlineNowDto>({
    queryKey: qk.live.online(query),
    queryFn: ({ signal }) => api.live.online(query, { signal }),
    placeholderData: keepPreviousData,
    staleTime: ONLINE_NOW_REFRESH_MS,
    refetchInterval: ONLINE_NOW_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

/** People online in one app (verified + anonymous), 0 when the app is not in the answer. */
export function onlineCountOf(data: OnlineNowDto | undefined, app: string): number {
  const entry = data?.apps.find((item) => item.app === app);
  return entry ? entry.users + entry.anonymous : 0;
}
