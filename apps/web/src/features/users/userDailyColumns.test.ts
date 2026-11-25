import { describe, expect, it } from 'vitest';

import { DAILY_TABLE_MIN_WIDTH_CLASS, dailyColumns } from './userDailyColumns';

/** The narrowest Apps column the table may leave at its minimum width. */
const APPS_MIN_REM = 10;
/** Tailwind spacing: w-N is N × 0.25rem. */
const REM_PER_SPACING_STEP = 0.25;

/** "w-36" → 9 (rem); a class list without a w-N width → undefined. */
function fixedWidthRem(className: string | undefined): number | undefined {
  const match = className?.match(/(?:^|\s)w-(\d+)(?:\s|$)/);
  return match ? Number(match[1]) * REM_PER_SPACING_STEP : undefined;
}

describe('dailyColumns width budget', () => {
  it('leaves Apps at least 10rem at the table minimum width', () => {
    const minRem = Number(DAILY_TABLE_MIN_WIDTH_CLASS.match(/^min-w-\[(\d+(?:\.\d+)?)rem\]$/)?.[1]);
    expect(minRem).toBeGreaterThan(0);

    const columns = dailyColumns('user-key', {});
    const apps = columns.filter((column) => fixedWidthRem(column.className) === undefined);
    expect(apps.map((column) => column.header)).toEqual(['Apps']);

    const fixedRem = columns.reduce((sum, column) => sum + (fixedWidthRem(column.className) ?? 0), 0);
    expect(minRem - fixedRem).toBeGreaterThanOrEqual(APPS_MIN_REM);
  });
});
