import { describe, expect, it } from 'vitest';

import { encodeKeysetCursor } from '../db/sql';
import { BadRequestError } from '../errors/app-error';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from './pagination';

describe('toCursorPage', () => {
  const identity = (n: number) => n;
  const cursorOf = (n: number) => `after-${n}`;

  it('shows `limit` rows and builds the cursor from the last SHOWN row when one more came back', () => {
    expect(toCursorPage([1, 2, 3], 2, identity, cursorOf)).toEqual({
      items: [1, 2],
      nextCursor: 'after-2',
    });
  });

  it('has no next page when the extra row is missing', () => {
    expect(toCursorPage([1, 2], 2, identity, cursorOf)).toEqual({
      items: [1, 2],
      nextCursor: null,
    });
    expect(toCursorPage([], 2, identity, cursorOf)).toEqual({ items: [], nextCursor: null });
  });

  it('asks for one extra row', () => {
    expect(pageFetchSize(50)).toBe(51);
  });
});

describe('parseKeysetCursor', () => {
  const eventId = '44444444-4444-4444-8444-444444444444';

  it('round-trips an encoded keyset with MICROSECONDS and treats a missing cursor as page one', () => {
    const at = '2026-10-01T09:15:30.250123Z';
    expect(parseKeysetCursor(encodeKeysetCursor(at, eventId))).toEqual({ occurredAt: at, eventId });
    expect(parseKeysetCursor(undefined)).toBeNull();
  });

  it('rejects a cursor whose time is not ISO-8601 UTC text', () => {
    expect(() => parseKeysetCursor(encodeKeysetCursor('yesterday', eventId))).toThrow(
      BadRequestError,
    );
    expect(() => parseKeysetCursor(encodeKeysetCursor('2026-13-45T99:00:00Z', eventId))).toThrow(
      BadRequestError,
    );
  });

  it('rejects garbage and a tampered event id with 400 (never a SQL cast error)', () => {
    expect(() => parseKeysetCursor('not-a-cursor')).toThrow(BadRequestError);
    const tampered = Buffer.from(`k:2026-10-01T00:00:00.000Z|1' OR '1'='1`).toString('base64url');
    expect(() => parseKeysetCursor(tampered)).toThrow(BadRequestError);
  });
});
