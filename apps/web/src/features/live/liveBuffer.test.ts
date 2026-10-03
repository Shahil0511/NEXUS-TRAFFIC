import { LIVE_SNAPSHOT_MINUTES, type LiveEventDto, type LiveTickDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { latestTick, mergeEvents, ticksToPoints, upsertTick } from './liveBuffer';

function tick(minute: string, requests: number): LiveTickDto {
  return {
    scope: 'all',
    minute,
    requests,
    errors4xx: 0,
    errors5xx: 0,
    p95Ms: null,
    pageViews: 0,
    toolUses: 0,
    activeUsers: 1,
  };
}

function event(eventId: string, occurredAt: string): LiveEventDto {
  return {
    eventId,
    occurredAt,
    app: 'ebo-sales',
    kind: 'api',
    path: '/x',
    method: 'GET',
    status: 200,
    durationMs: 1,
    tool: null,
    userEmail: null,
    ip: null,
    country: null,
    city: null,
  };
}

const M0 = '2026-10-01T10:00:00.000Z';
const M1 = '2026-10-01T10:01:00.000Z';

describe('upsertTick', () => {
  it('replaces the tick of the same minute (counts are cumulative)', () => {
    const next = upsertTick({ ticks: [tick(M0, 3)], recent: [] }, tick(M0, 5));
    expect(next?.ticks).toEqual([tick(M0, 5)]);
  });

  it('appends a new minute and keeps only LIVE_SNAPSHOT_MINUTES', () => {
    const ticks = Array.from({ length: LIVE_SNAPSHOT_MINUTES }, (_, i) =>
      tick(new Date(Date.parse(M0) - (LIVE_SNAPSHOT_MINUTES - 1 - i) * 60_000).toISOString(), i),
    );
    const next = upsertTick({ ticks, recent: [] }, tick(M1, 9));
    expect(next?.ticks).toHaveLength(LIVE_SNAPSHOT_MINUTES);
    expect(latestTick(next!.ticks)).toEqual(tick(M1, 9));
    expect(next?.ticks[0]?.minute).toBe(ticks[1]?.minute);
  });

  it('does nothing before the snapshot has loaded', () => {
    expect(upsertTick(undefined, tick(M0, 1))).toBeUndefined();
  });
});

describe('mergeEvents', () => {
  it('de-duplicates by eventId, sorts newest first and caps', () => {
    const merged = mergeEvents(
      [event('a', '2026-10-01T10:00:01Z'), event('b', '2026-10-01T10:00:02Z')],
      [event('c', '2026-10-01T10:00:03Z'), event('a', '2026-10-01T10:00:01Z')],
      2,
    );
    expect(merged.map((e) => e.eventId)).toEqual(['c', 'b']);
  });
});

describe('ticksToPoints', () => {
  it('maps ticks onto chart points by minute', () => {
    expect(ticksToPoints([tick(M0, 4)])).toEqual([
      { bucket: M0, requests: 4, errors4xx: 0, errors5xx: 0, p95Ms: null, pageViews: 0 },
    ]);
  });
});
