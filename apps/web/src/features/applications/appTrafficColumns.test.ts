import { render, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';

import type { CheckState } from '@/components/HealthMark';
import { appTraffic } from '@/test/fixtures';

import { appTrafficColumns, SECONDARY_COLUMN } from './appTrafficColumns';

/** Render the Application cell of one row with the given Data health lookup. */
function renderAppCell(healthOf: (app: string) => CheckState | undefined) {
  const [appColumn] = appTrafficColumns(
    {},
    () => null,
    () => undefined,
    healthOf,
  );
  return render(createElement(Fragment, null, appColumn!.cell(appTraffic())));
}

describe('appTrafficColumns', () => {
  const columns = appTrafficColumns(
    {},
    () => null,
    () => undefined,
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

  it("puts the app's Data health mark inside the row link, labelled for screen readers", () => {
    renderAppCell(() => 'warn');
    const link = screen.getByRole('link', { name: /EBO Sales/ });
    expect(link).toHaveTextContent('Data health: Needs attention');
    expect(link.querySelectorAll('a')).toHaveLength(0);
  });

  it('shows no mark when the health of the app is unknown', () => {
    renderAppCell(() => undefined);
    expect(screen.getByRole('link', { name: /EBO Sales/ })).not.toHaveTextContent('Data health');
  });
});
