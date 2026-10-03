/**
 * Sends the live data to the subscribed rooms, shaped per role.
 *
 * WHY: one place decides WHO receives WHAT. Every scope has two rooms (`liveRoom(filter, role)`):
 * the admin room gets events with the stored IP, the viewer room gets `withoutIp` copies — a
 * viewer socket is never in a room that receives an IP (ADR 0001 "IP / PII").
 *
 * - `enqueue` collects committed events per app (called by LiveFeed, capped).
 * - `flushEvents` (every LIVE_EVENTS_FLUSH_MS) emits ≤ LIVE_EVENTS_MAX_BATCH events per room,
 *   newest first, to the app's rooms and to the all-apps rooms.
 * - `emitTicks` (every LIVE_TICK_MS) emits the current-minute counters of every subscribed scope.
 *
 * The namespace is passed in (not held) so the container can build this before the HTTP server.
 */
import {
  LIVE_EVENTS_MAX_BATCH,
  LIVE_ROLE_VALUES,
  liveRoom,
  liveRoomOfScope,
  parseLiveRoom,
  SOCKET_EVENTS,
  type LiveEventDto,
  type LiveRole,
} from '@nexus/shared';

import { withoutIp } from '../domain/mappers';
import type { LiveNamespace } from './live-socket';
import type { LiveWindow } from './live-window';

/** The parts of the Socket.io namespace the broadcaster uses (tests pass a fake). */
export type LiveEmitTarget = Pick<LiveNamespace, 'to' | 'adapter'>;

/** Newest first (occurredAt, then eventId for a stable order). */
function newestFirst(a: LiveEventDto, b: LiveEventDto): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.eventId.localeCompare(a.eventId);
}

/** The newest `LIVE_EVENTS_MAX_BATCH` events, newest first. */
function capBatch(events: LiveEventDto[]): LiveEventDto[] {
  return events.sort(newestFirst).slice(0, LIVE_EVENTS_MAX_BATCH);
}

/** The payload a role may receive: admins as recorded, everyone else without the IP. */
export function eventsForRole(events: readonly LiveEventDto[], role: LiveRole): LiveEventDto[] {
  return role === 'admin' ? [...events] : events.map(withoutIp);
}

export class LiveBroadcaster {
  /** Admin-form events waiting for the next flush, per app slug. */
  private pending = new Map<string, LiveEventDto[]>();

  constructor(private readonly window: LiveWindow) {}

  /** Queues committed events (ADMIN form) of one app; only the newest batch is kept. */
  enqueue(appSlug: string, events: readonly LiveEventDto[]): void {
    if (events.length === 0) return;
    const queued = [...(this.pending.get(appSlug) ?? []), ...events];
    this.pending.set(appSlug, queued.length > LIVE_EVENTS_MAX_BATCH ? capBatch(queued) : queued);
  }

  /** Emits the queued events to each app's rooms and to the all-apps rooms, then clears the queue. */
  flushEvents(target: LiveEmitTarget): void {
    if (this.pending.size === 0) return;
    const byApp = this.pending;
    this.pending = new Map();
    const all: LiveEventDto[] = [];
    for (const [app, events] of byApp) {
      this.emitEvents(target, (role) => liveRoom({ app }, role), capBatch(events));
      all.push(...events);
    }
    this.emitEvents(target, (role) => liveRoom({}, role), capBatch(all));
  }

  /** Emits the current-minute tick of every scope that has at least one subscriber. */
  emitTicks(target: LiveEmitTarget, at: Date): void {
    for (const scope of subscribedScopes(target)) {
      const tick = this.window.tick(scope, at);
      const rooms = LIVE_ROLE_VALUES.map((role) => liveRoomOfScope(scope, role));
      target.to(rooms).emit(SOCKET_EVENTS.trafficTick, tick);
    }
  }

  private emitEvents(
    target: LiveEmitTarget,
    roomOf: (role: LiveRole) => string,
    events: LiveEventDto[],
  ): void {
    for (const role of LIVE_ROLE_VALUES) {
      target.to(roomOf(role)).emit(SOCKET_EVENTS.trafficEvents, eventsForRole(events, role));
    }
  }
}

/** Scope keys of the live rooms that currently have members (socket-id rooms are ignored). */
export function subscribedScopes(target: Pick<LiveEmitTarget, 'adapter'>): Set<string> {
  const scopes = new Set<string>();
  for (const [room, members] of target.adapter.rooms) {
    const parsed = parseLiveRoom(room);
    if (parsed && members.size > 0) scopes.add(parsed.scope);
  }
  return scopes;
}
