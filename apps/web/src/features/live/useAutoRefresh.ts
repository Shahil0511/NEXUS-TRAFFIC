'use client';

import { SOCKET_EVENTS, type LiveFilter } from '@nexus/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { createLiveSocket } from '@/lib/socket';

import {
  AUTO_REFRESH_MIN_INTERVAL_MS,
  createThrottle,
  isTrafficDrivenKey,
} from './autoRefreshPolicy';

/**
 * WHY: keeps every open analytics page (Overview, API Routes, Errors, Users, Journeys, Pages,
 * Tools, Geography, Integration) current without a page switch. It listens on the same live
 * socket as the Live page, scoped like the global filter (one app, or all), and on each batch of
 * committed events (`traffic:events`) — or a reconnect, which may have missed some — invalidates
 * the traffic-driven queries, throttled to AUTO_REFRESH_MIN_INTERVAL_MS. Invalidation refetches
 * only queries on screen; the rest are just marked stale and refetch when their page opens.
 *
 * Deliberately quiet on failure: a refused handshake or an expired session is handled by the
 * normal 401 flow of the next API call, so this hook never redirects on its own.
 *
 * @see ./autoRefreshPolicy.ts    what is refreshed and how often
 * @see ./useLiveFeed.ts    the Live page's own use of the socket
 */
export function useAutoRefresh(filter: LiveFilter, enabled: boolean): void {
  const app = filter.app;
  const query = useMemo(() => (app ? { app } : {}), [app]);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;
    const throttle = createThrottle(
      () => void queryClient.invalidateQueries({ predicate: (q) => isTrafficDrivenKey(q.queryKey) }),
      AUTO_REFRESH_MIN_INTERVAL_MS,
    );
    const socket = createLiveSocket();
    let connectedBefore = false;

    socket.on('connect', () => {
      socket.emit(SOCKET_EVENTS.subscribe, query, () => undefined);
      if (connectedBefore) throttle.request();
      connectedBefore = true;
    });
    socket.on(SOCKET_EVENTS.trafficEvents, (batch) => {
      if (batch.length > 0) throttle.request();
    });
    socket.connect();

    return () => {
      throttle.cancel();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, query, queryClient]);
}
