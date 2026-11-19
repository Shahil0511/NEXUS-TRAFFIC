import { describe, expect, it, vi } from 'vitest';

import { apiRequestInsert, webEventInsert } from '../../test/fixtures/live-inserts';
import { appRow, fake } from '../../test/ingest-fixtures';
import { FixedClock } from '../lib/clock';
import type { LiveBroadcaster } from './live.broadcaster';
import { LiveFeed } from './live-feed';
import type { LiveWindow } from './live-window';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build() {
  const window = { recordApiRequest: vi.fn(), recordWebEvent: vi.fn() };
  const broadcaster = { enqueue: vi.fn() };
  const feed = new LiveFeed(fake<LiveWindow>(window), fake<LiveBroadcaster>(broadcaster), new FixedClock(NOW));
  return { feed, window, broadcaster };
}

describe('LiveFeed (Live is prod-only, ADR 0008)', () => {
  it('counts and streams prod API requests, ignores staging and dev', () => {
    const { feed, window, broadcaster } = build();
    feed.recordApiRequests(appRow(), [
      apiRequestInsert({ eventId: '00000000-0000-4000-8000-000000000001' }),
      apiRequestInsert({ eventId: '00000000-0000-4000-8000-000000000002', environment: 'staging' }),
      apiRequestInsert({ eventId: '00000000-0000-4000-8000-000000000003', environment: 'dev' }),
    ]);
    expect(window.recordApiRequest).toHaveBeenCalledTimes(1);
    const [, events] = broadcaster.enqueue.mock.calls[0] as [string, unknown[]];
    expect(events).toHaveLength(1);
  });

  it('counts and streams prod web events, ignores dev', () => {
    const { feed, window, broadcaster } = build();
    feed.recordWebEvents(appRow(), [
      webEventInsert({ eventId: '00000000-0000-4000-8000-000000000004', environment: 'dev' }),
      webEventInsert({ eventId: '00000000-0000-4000-8000-000000000005' }),
    ]);
    expect(window.recordWebEvent).toHaveBeenCalledTimes(1);
    const [slug, events] = broadcaster.enqueue.mock.calls[0] as [string, unknown[]];
    expect(slug).toBe('ebo-sales');
    expect(events).toHaveLength(1);
  });

  it('a dev-only batch records and streams nothing', () => {
    const { feed, window, broadcaster } = build();
    feed.recordWebEvents(appRow(), [webEventInsert({ environment: 'dev' })]);
    expect(window.recordWebEvent).not.toHaveBeenCalled();
    expect(broadcaster.enqueue).toHaveBeenCalledWith('ebo-sales', []);
  });
});
