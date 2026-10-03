/**
 * Entry point from ingest into the real-time layer: receives ONLY committed, non-duplicate rows
 * (IngestService.publishLive), counts them into the LiveWindow and queues them as Live events on
 * the LiveBroadcaster.
 *
 * WHY: ingest knows nothing about sockets; this is the one seam between the write path and the
 * live dashboard. It never throws into ingest for a socket problem — IngestService also guards it.
 */
import type { BrowserEventType, LiveEventDto } from '@nexus/shared';

import type { ApiRequestInsert, WebEventInsert } from '../domain/inserts';
import { liveEventOfApiRequest, liveEventOfWebEvent } from '../domain/mappers';
import type { AppRow } from '../domain/rows';
import type { Clock } from '../lib/clock';
import type { LiveBroadcaster } from './live.broadcaster';
import type { LiveWindow } from './live-window';

/**
 * `page_time` rows are visible-time DELTAS of a page already shown as a page view: they count
 * nowhere in the stream (same rule as the user timeline).
 */
const NOT_STREAMED: ReadonlySet<BrowserEventType> = new Set<BrowserEventType>(['page_time']);

/**
 * WHY: the actor of "active users now" — a verified user, else the session (the same rule as
 * WebEventQueryRepository.countActiveUsers); null when the row carries neither.
 */
export function liveActorOf(row: {
  userKey: Buffer | null;
  sessionId: string | null;
}): string | null {
  if (row.userKey) return `user:${row.userKey.toString('hex')}`;
  return row.sessionId ? `session:${row.sessionId}` : null;
}

export class LiveFeed {
  constructor(
    private readonly window: LiveWindow,
    private readonly broadcaster: LiveBroadcaster,
    private readonly clock: Clock,
  ) {}

  recordApiRequests(app: AppRow, rows: readonly ApiRequestInsert[]): void {
    const now = this.clock.now();
    const events: LiveEventDto[] = [];
    for (const row of rows) {
      this.window.recordApiRequest(
        app.slug,
        {
          kind: row.kind,
          statusCode: row.statusCode,
          durationMs: row.durationMs,
          actor: liveActorOf(row),
        },
        now,
      );
      events.push(liveEventOfApiRequest(app.slug, row));
    }
    this.broadcaster.enqueue(app.slug, events);
  }

  recordWebEvents(app: AppRow, rows: readonly WebEventInsert[]): void {
    const now = this.clock.now();
    const events: LiveEventDto[] = [];
    for (const row of rows) {
      this.window.recordWebEvent(
        app.slug,
        { eventType: row.eventType, actor: liveActorOf(row) },
        now,
      );
      if (!NOT_STREAMED.has(row.eventType)) events.push(liveEventOfWebEvent(app.slug, row));
    }
    this.broadcaster.enqueue(app.slug, events);
  }
}
