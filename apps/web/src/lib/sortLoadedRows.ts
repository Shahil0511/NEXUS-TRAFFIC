import type { SortDirection } from '@nexus/shared';

/**
 * WHY: the Pages and Features lists are a capped top N (the API sends at most 100 rows, ranked by
 * views / uses), so a header click sorts the rows ALREADY loaded instead of asking the API again.
 * One helper so both lists order the same way: rows without a value (`null`, e.g. a page with no
 * measured visible time) go LAST in both directions, and equal values fall back to `tieKeyOf`
 * (ascending) so the order never jumps between renders. Pure; returns a new array (or `undefined`
 * while nothing is loaded).
 */
export function sortLoadedRows<T>(
  rows: readonly T[] | undefined,
  valueOf: (row: T) => number | null,
  dir: SortDirection,
  tieKeyOf: (row: T) => string,
): readonly T[] | undefined {
  if (!rows) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else if (left !== right) {
      return (left - right) * sign;
    }
    return compareKeys(tieKeyOf(a), tieKeyOf(b));
  });
}

/** Plain code-point order: the same in every browser locale (localeCompare is not). */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** What a sorted column holds, so its caption reads naturally ("most first", "longest first"). */
export type SortValueKind = 'count' | 'duration' | 'date';

const ORDER_WORDS: Record<SortValueKind, Record<SortDirection, string>> = {
  count: { desc: 'most first', asc: 'fewest first' },
  duration: { desc: 'longest first', asc: 'shortest first' },
  date: { desc: 'latest first', asc: 'earliest first' },
};

/**
 * WHY: a client-sorted table says how it is ordered in its description, in plain words
 * ("Sorted by views, most first"), never as a position or a place in a list (neutral wording,
 * ADR 0018). Pure.
 */
export function sortedByCaption(label: string, kind: SortValueKind, dir: SortDirection): string {
  return `Sorted by ${label}, ${ORDER_WORDS[kind][dir]}`;
}
