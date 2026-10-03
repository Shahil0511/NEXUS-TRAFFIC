import {
  LIVE_EVENTS_MAX_BATCH,
  liveRoom,
  SOCKET_EVENTS,
  type LiveEventDto,
  type LiveTickDto,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { apiRequestInsert, LIVE_IP, webEventInsert } from '../../test/fixtures/live-inserts';
import { appRow } from '../../test/ingest-fixtures';
import { FixedClock } from '../lib/clock';
import { LiveBroadcaster, subscribedScopes, type LiveEmitTarget } from './live.broadcaster';
import { liveActorOf, LiveFeed } from './live-feed';
import { LiveWindow } from './live-window';

const NOW = new Date('2026-10-01T10:00:05.000Z');

interface Emitted {
  rooms: string[];
  event: string;
  payload: unknown;
}

/** A fake namespace: records every `to(rooms).emit(event, payload)`; `rooms` lists members. */
function fakeTarget(memberRooms: string[] = []): { target: LiveEmitTarget; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const rooms = new Map<string, Set<string>>([['socket-id-1', new Set(['socket-id-1'])]]);
  for (const room of memberRooms) rooms.set(room, new Set(['socket-id-1']));
  const target = {
    adapter: { rooms },
    to: (room: string | string[]) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ rooms: Array.isArray(room) ? room : [room], event, payload });
        return true;
      },
    }),
  } as unknown as LiveEmitTarget;
  return { target, emitted };
}

function build() {
  const window = new LiveWindow();
  const broadcaster = new LiveBroadcaster(window);
  const feed = new LiveFeed(window, broadcaster, new FixedClock(NOW));
  return { window, broadcaster, feed };
}

const eventsTo = (emitted: Emitted[], room: string) =>
  emitted
    .filter((e) => e.event === SOCKET_EVENTS.trafficEvents && e.rooms.includes(room))
    .flatMap((e) => e.payload as LiveEventDto[]);

describe('LiveBroadcaster.flushEvents', () => {
  it('sends the IP to admin rooms ONLY — viewer payloads never carry an IP', () => {
    const { feed, broadcaster } = build();
    feed.recordApiRequests(appRow(), [apiRequestInsert()]);
    const { target, emitted } = fakeTarget();
    broadcaster.flushEvents(target);

    for (const filter of [{ app: 'ebo-sales' }, {}]) {
      const admin = eventsTo(emitted, liveRoom(filter, 'admin'));
      const viewer = eventsTo(emitted, liveRoom(filter, 'viewer'));
      expect(admin).toHaveLength(1);
      expect(admin[0]?.ip).toBe(LIVE_IP);
      expect(viewer).toHaveLength(1);
      expect(viewer[0]?.ip).toBeNull();
      expect(JSON.stringify(viewer)).not.toContain(LIVE_IP);
    }
  });

  it('emits one batch per room, newest first, capped at LIVE_EVENTS_MAX_BATCH, then clears', () => {
    const { feed, broadcaster } = build();
    const rows = Array.from({ length: LIVE_EVENTS_MAX_BATCH + 20 }, (_, i) =>
      apiRequestInsert({
        eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        occurredAt: new Date(NOW.getTime() - (LIVE_EVENTS_MAX_BATCH + 20 - i) * 10),
      }),
    );
    feed.recordApiRequests(appRow(), rows);
    const { target, emitted } = fakeTarget();
    broadcaster.flushEvents(target);

    const batch = eventsTo(emitted, liveRoom({}, 'viewer'));
    expect(batch).toHaveLength(LIVE_EVENTS_MAX_BATCH);
    expect(batch[0]?.eventId).toBe(rows.at(-1)?.eventId);
    expect(batch[0]!.occurredAt >= batch[1]!.occurredAt).toBe(true);

    const again = fakeTarget();
    broadcaster.flushEvents(again.target);
    expect(again.emitted).toEqual([]);
  });

  it('merges every app into the all-apps rooms and keeps apps apart in their own rooms', () => {
    const { feed, broadcaster } = build();
    feed.recordApiRequests(appRow({ slug: 'ebo-sales' }), [apiRequestInsert()]);
    feed.recordWebEvents(appRow({ slug: 'hr' }), [webEventInsert()]);
    const { target, emitted } = fakeTarget();
    broadcaster.flushEvents(target);

    expect(
      eventsTo(emitted, liveRoom({}, 'viewer'))
        .map((e) => e.app)
        .sort(),
    ).toEqual(['ebo-sales', 'hr']);
    expect(eventsTo(emitted, liveRoom({ app: 'hr' }, 'viewer')).map((e) => e.kind)).toEqual([
      'page_view',
    ]);
  });
});

describe('LiveBroadcaster.emitTicks', () => {
  it('ticks only the scopes that have subscribers, to both role rooms', () => {
    const { feed, broadcaster } = build();
    feed.recordApiRequests(appRow(), [apiRequestInsert({ statusCode: 500 })]);
    const { target, emitted } = fakeTarget([liveRoom({ app: 'ebo-sales' }, 'viewer')]);
    broadcaster.emitTicks(target, NOW);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe(SOCKET_EVENTS.trafficTick);
    expect(emitted[0]?.rooms).toEqual([
      liveRoom({ app: 'ebo-sales' }, 'admin'),
      liveRoom({ app: 'ebo-sales' }, 'viewer'),
    ]);
    expect(emitted[0]?.payload).toMatchObject<Partial<LiveTickDto>>({
      scope: 'app:ebo-sales',
      requests: 1,
      errors5xx: 1,
    });
  });

  it('finds subscribed scopes from role rooms only', () => {
    const { target } = fakeTarget([liveRoom({}, 'admin'), liveRoom({ app: 'hr' }, 'viewer')]);
    expect([...subscribedScopes(target)].sort()).toEqual(['all', 'app:hr']);
  });
});

describe('LiveFeed', () => {
  it('counts page_time but never streams it', () => {
    const { feed, broadcaster, window } = build();
    feed.recordWebEvents(appRow(), [
      webEventInsert({ eventType: 'page_time', visibleMs: 1000 }),
      webEventInsert({
        eventType: 'tool_use',
        tool: 'export',
        eventId: '88888888-8888-4888-8888-888888888888',
      }),
    ]);
    const { target, emitted } = fakeTarget();
    broadcaster.flushEvents(target);
    expect(eventsTo(emitted, liveRoom({}, 'admin')).map((e) => e.kind)).toEqual(['tool_use']);
    expect(window.tick('all', NOW)).toMatchObject({ toolUses: 1, pageViews: 0, activeUsers: 1 });
  });

  it('identifies actors by verified user, else by session', () => {
    expect(liveActorOf({ userKey: Buffer.alloc(2, 1), sessionId: 's' })).toBe('user:0101');
    expect(liveActorOf({ userKey: null, sessionId: 's' })).toBe('session:s');
    expect(liveActorOf({ userKey: null, sessionId: null })).toBeNull();
  });
});
