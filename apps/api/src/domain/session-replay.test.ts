import { describe, expect, it } from 'vitest';

import { sessionEventRow } from '../../test/fixtures/analytics-rows';
import { interleaveByTime } from './session-replay';

const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 9, 0, second));
const browser = (id: string, seq: number, second: number) =>
  sessionEventRow({ event_id: id, seq, occurred_at: at(second) });
const api = (id: string, second: number) =>
  sessionEventRow({ event_id: id, seq: null, kind: 'api', occurred_at: at(second) });

const ids = (rows: ReturnType<typeof interleaveByTime>) => rows.map((row) => row.event_id);

describe('interleaveByTime', () => {
  it('places each API call before the first browser event that happened after it', () => {
    const merged = interleaveByTime(
      [browser('b0', 0, 0), browser('b1', 1, 10), browser('b2', 2, 20)],
      [api('a5', 5), api('a15', 15), api('a25', 25)],
    );
    expect(ids(merged)).toEqual(['b0', 'a5', 'b1', 'a15', 'b2', 'a25']);
  });

  it('never reorders browser events, even when the device clock disagrees with seq', () => {
    // seq 1 has an EARLIER timestamp than seq 0 (clock adjusted mid-session): the call at 7 s
    // goes before the first browser event later than it (b0 at 10 s), and b1 stays after b0.
    const merged = interleaveByTime([browser('b0', 0, 10), browser('b1', 1, 5)], [api('a7', 7)]);
    expect(ids(merged)).toEqual(['a7', 'b0', 'b1']);
  });

  it('an API call at the same instant as a browser event comes after it', () => {
    expect(ids(interleaveByTime([browser('b0', 0, 3)], [api('a3', 3)]))).toEqual(['b0', 'a3']);
  });

  it('handles empty inputs', () => {
    expect(interleaveByTime([], [api('a1', 1)]).map((r) => r.event_id)).toEqual(['a1']);
    expect(interleaveByTime([browser('b0', 0, 1)], [])).toHaveLength(1);
    expect(interleaveByTime([], [])).toEqual([]);
  });
});
