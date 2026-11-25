import type { ToolUsageDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { TOOL_USAGE } from '@/test/fixtures';

import { sortTools, toolKey, toolSortCaption, TOOL_SORT_VALUES } from './toolSort';

const EXPORT: ToolUsageDto = TOOL_USAGE.items[0]!;
const FILTER: ToolUsageDto = {
  ...EXPORT,
  tool: 'date-filter',
  uses: 300,
  distinctUsers: 50,
  distinctSessions: 80,
  lastUsedAt: '2026-10-01T08:30:00.000Z',
};
const BROKEN: ToolUsageDto = { ...EXPORT, tool: 'bad-date', uses: 1, lastUsedAt: 'not a date' };
const ROWS = [FILTER, EXPORT, BROKEN];

const namesOf = (rows: readonly ToolUsageDto[] | undefined) => rows?.map((row) => row.tool);

describe('sortTools', () => {
  it('sorts by uses and by people in both directions', () => {
    expect(namesOf(sortTools(ROWS, 'uses', 'desc'))).toEqual([
      'export-csv',
      'date-filter',
      'bad-date',
    ]);
    expect(namesOf(sortTools(ROWS, 'people', 'desc'))).toEqual([
      'date-filter',
      'bad-date',
      'export-csv',
    ]);
    expect(namesOf(sortTools(ROWS, 'people', 'asc'))).toEqual([
      'bad-date',
      'export-csv',
      'date-filter',
    ]);
  });

  it('breaks ties by app|name and puts an unreadable last use last', () => {
    expect(namesOf(sortTools(ROWS, 'sessions', 'desc'))).toEqual([
      'bad-date',
      'date-filter',
      'export-csv',
    ]);
    expect(namesOf(sortTools(ROWS, 'lastUsed', 'desc'))).toEqual([
      'date-filter',
      'export-csv',
      'bad-date',
    ]);
    expect(namesOf(sortTools(ROWS, 'lastUsed', 'asc'))).toEqual([
      'export-csv',
      'date-filter',
      'bad-date',
    ]);
  });

  it('sorts every key without touching the input', () => {
    for (const key of TOOL_SORT_VALUES) expect(sortTools(ROWS, key, 'asc')).toHaveLength(3);
    expect(ROWS).toEqual([FILTER, EXPORT, BROKEN]);
    expect(sortTools(undefined, 'uses', 'desc')).toBeUndefined();
    expect(toolKey(EXPORT)).toBe('ebo-sales|export-csv');
  });

  it('names the order in the table description', () => {
    expect(toolSortCaption('uses', 'desc')).toBe('Sorted by uses, most first');
    expect(toolSortCaption('lastUsed', 'desc')).toBe('Sorted by last use, latest first');
    expect(toolSortCaption('people', 'asc')).toBe('Sorted by people, fewest first');
  });
});
