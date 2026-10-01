import { EVENT_CLOCK_POLICY } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { EventTimeGuard } from './event-time.guard';

const RECEIVED = new Date('2026-10-01T10:00:00.000Z');
const at = (offsetMs: number) => new Date(RECEIVED.getTime() + offsetMs);

describe('EventTimeGuard.isAcceptable', () => {
  const guard = new EventTimeGuard();

  it.each([
    ['now', 0, true],
    ['exactly 7 days old', -EVENT_CLOCK_POLICY.maxBackdateMs, true],
    ['7 days + 1 ms old', -EVENT_CLOCK_POLICY.maxBackdateMs - 1, false],
    ['exactly 5 min ahead', EVENT_CLOCK_POLICY.maxFutureMs, true],
    ['5 min + 1 ms ahead', EVENT_CLOCK_POLICY.maxFutureMs + 1, false],
  ])('%s → %s', (_label, offset, expected) => {
    expect(guard.isAcceptable(at(offset), RECEIVED)).toBe(expected);
  });

  it('rejects an invalid date', () => {
    expect(guard.isAcceptable(new Date('nope'), RECEIVED)).toBe(false);
  });
});

describe('EventTimeGuard.skewMs', () => {
  const guard = new EventTimeGuard();

  it('is receivedAt − sentAt (positive when the sender is behind)', () => {
    expect(guard.skewMs('2026-10-01T09:59:58.500Z', RECEIVED)).toBe(1500);
    expect(guard.skewMs('2026-10-01T15:30:02.000+05:30', RECEIVED)).toBe(-2000);
  });

  it('is null for an unparseable sentAt', () => {
    expect(guard.skewMs('not a date', RECEIVED)).toBeNull();
  });
});
