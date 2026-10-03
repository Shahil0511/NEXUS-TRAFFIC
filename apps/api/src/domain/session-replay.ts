/**
 * Builds the event list of a session replay from its two sources.
 *
 * WHY: browser events are ordered by the tracker's `seq` (then time), which is the true click order
 * even when device clocks drift; API calls have no seq, only the server time. A SQL UNION could
 * order by one key only, so the merge lives here, pure and unit-tested: every API call is placed
 * right before the first browser event that happened AFTER it, keeping both inputs' own order.
 */
import type { SessionEventRow } from './rows';

/**
 * Merge `browserEvents` (in replay order) with `apiCalls` (oldest first). Neither input is
 * reordered; an API call at the same instant as a browser event comes after it.
 */
export function interleaveByTime(
  browserEvents: readonly SessionEventRow[],
  apiCalls: readonly SessionEventRow[],
): SessionEventRow[] {
  const merged: SessionEventRow[] = [];
  let next = 0;
  for (const event of browserEvents) {
    let call = apiCalls[next];
    while (call !== undefined && call.occurred_at < event.occurred_at) {
      merged.push(call);
      next += 1;
      call = apiCalls[next];
    }
    merged.push(event);
  }
  return merged.concat(apiCalls.slice(next));
}
