import { describe, expect, it } from 'vitest';

import { appTrafficColumns, SECONDARY_COLUMN } from './appTrafficColumns';

describe('appTrafficColumns', () => {
  const columns = appTrafficColumns(
    {},
    () => null,
    () => undefined,
  );

  it('shows the secondary columns from 2xl only, so the table fits a laptop screen', () => {
    const secondary = columns
      .filter((column) => column.className?.includes(SECONDARY_COLUMN))
      .map((column) => column.id);
    expect(secondary).toEqual(['p95', 'sessions', 'toolUses', 'linked']);
  });

  it('keeps a minimum width on the Application column so app names stay readable', () => {
    expect(columns[0]?.className).toContain('min-w-48');
  });
});
