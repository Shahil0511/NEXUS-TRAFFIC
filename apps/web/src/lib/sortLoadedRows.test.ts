import { describe, expect, it } from 'vitest';

import { findBannedWords } from './neutralCopy';
import { sortedByCaption, sortLoadedRows } from './sortLoadedRows';

interface Row {
  key: string;
  value: number | null;
}

const ROWS: readonly Row[] = [
  { key: 'b', value: 5 },
  { key: 'n', value: null },
  { key: 'a', value: 5 },
  { key: 'c', value: 9 },
];

const keysOf = (rows: readonly Row[] | undefined) => rows?.map((row) => row.key);
const sortRows = (dir: 'asc' | 'desc') =>
  sortLoadedRows(
    ROWS,
    (row) => row.value,
    dir,
    (row) => row.key,
  );

describe('sortLoadedRows', () => {
  it('sorts descending with nulls last and ties by key', () => {
    expect(keysOf(sortRows('desc'))).toEqual(['c', 'a', 'b', 'n']);
  });

  it('sorts ascending with nulls still last', () => {
    expect(keysOf(sortRows('asc'))).toEqual(['a', 'b', 'c', 'n']);
  });

  it('never mutates its input and passes undefined through', () => {
    sortRows('asc');
    expect(keysOf(ROWS)).toEqual(['b', 'n', 'a', 'c']);
    expect(
      sortLoadedRows<Row>(
        undefined,
        (row) => row.value,
        'desc',
        (row) => row.key,
      ),
    ).toBeUndefined();
  });
});

describe('sortedByCaption', () => {
  it('names the order in plain words for counts, durations and dates', () => {
    expect(sortedByCaption('views', 'count', 'desc')).toBe('Sorted by views, most first');
    expect(sortedByCaption('views', 'count', 'asc')).toBe('Sorted by views, fewest first');
    expect(sortedByCaption('median visible time', 'duration', 'desc')).toBe(
      'Sorted by median visible time, longest first',
    );
    expect(sortedByCaption('last use', 'date', 'asc')).toBe('Sorted by last use, earliest first');
    expect(findBannedWords(sortedByCaption('people', 'count', 'desc'))).toEqual([]);
  });
});
