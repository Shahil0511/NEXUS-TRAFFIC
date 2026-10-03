'use client';

import {
  LIVE_AUTH_ERROR_MESSAGE,
  liveScopeKey,
  SOCKET_EVENTS,
  type LiveEventDto,
  type LiveFilter,
  type LiveSnapshotDto,
  type LiveTickDto,
} from '@nexus/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { qk } from '@/lib/query/keys';
import { createLiveSocket } from '@/lib/socket';

import { endLiveSession } from './endLiveSession';
import { mergeEvents, upsertTick } from './liveBuffer';
import { useLiveSnapshot } from './useLiveSnapshot';

/** What the connection indicator shows. */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveFeed {
  snapshot: ReturnType<typeof useLiveSnapshot>;
  /** The streaming table rows: socket events + the snapshot's recent events, newest first, capped. */
  events: LiveEventDto[];
  status: LiveStatus;
  paused: boolean;
  /** Events that arrived while paused (shown on resume). */
  heldCount: number;
  pause: () => void;
  resume: () => void;
}

/**
 * WHY: the whole Live data flow in one hook —
 * 1. backfill from the DB (useLiveSnapshot → GET ROUTES.live.snapshot);
 * 2. open the live socket, `live:subscribe` to the scope (all apps, or the app of the global filter);
 * 3. `traffic:tick` → upsert into the snapshot cache (tiles + chart move every LIVE_TICK_MS);
 * 4. `traffic:events` → prepend to a bounded buffer, or HOLD them while the table is paused;
 * 5. reconnect → re-subscribe and refetch the snapshot (fills the minutes the socket missed);
 * 6. `live:session-expired` or a refused handshake → back to the portal login (endLiveSession).
 * A new filter closes the socket and starts over with a fresh buffer.
 */
export function useLiveFeed(filter: LiveFilter): LiveFeed {
  const app = filter.app;
  const query = useMemo(() => (app ? { app } : {}), [app]);
  const snapshot = useLiveSnapshot(query);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [liveEvents, setLiveEvents] = useState<LiveEventDto[]>([]);
  const [held, setHeld] = useState<LiveEventDto[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const scope = liveScopeKey(query);
    const key = qk.live.snapshot(query);
    const socket = createLiveSocket();
    let connectedBefore = false;

    const subscribe = () =>
      socket.emit(SOCKET_EVENTS.subscribe, query, (ack) => setStatus(ack.ok ? 'live' : 'offline'));
    const onTick = (tick: LiveTickDto) => {
      if (tick.scope !== scope) return;
      queryClient.setQueryData(key, (current: LiveSnapshotDto | undefined) =>
        upsertTick(current, tick),
      );
    };
    const onEvents = (batch: LiveEventDto[]) => {
      if (pausedRef.current) setHeld((current) => mergeEvents(current, batch));
      else setLiveEvents((current) => mergeEvents(current, batch));
    };

    socket.on('connect', () => {
      subscribe();
      if (connectedBefore) void queryClient.invalidateQueries({ queryKey: key });
      connectedBefore = true;
    });
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', (err) => {
      if (err.message === LIVE_AUTH_ERROR_MESSAGE) {
        setStatus('offline');
        endLiveSession();
        return;
      }
      setStatus(socket.active ? 'reconnecting' : 'offline');
    });
    socket.on(SOCKET_EVENTS.trafficTick, onTick);
    socket.on(SOCKET_EVENTS.trafficEvents, onEvents);
    socket.on(SOCKET_EVENTS.sessionExpired, () => {
      setStatus('offline');
      endLiveSession();
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setLiveEvents([]);
      setHeld([]);
      setStatus('connecting');
    };
  }, [query, queryClient]);

  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => {
    setPaused(false);
    setLiveEvents((current) => mergeEvents(current, held));
    setHeld([]);
  }, [held]);

  const events = useMemo(
    () => mergeEvents(liveEvents, snapshot.data?.recent ?? []),
    [liveEvents, snapshot.data?.recent],
  );

  return { snapshot, events, status, paused, heldCount: held.length, pause, resume };
}
