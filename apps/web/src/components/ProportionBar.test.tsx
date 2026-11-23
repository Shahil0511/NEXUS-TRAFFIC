import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProportionBar, ProportionTable } from './ProportionBar';
import type { ProportionRow } from './proportionShares';

const ROWS: ProportionRow[] = [
  { key: 'v:Chrome', label: 'Chrome', count: 640, share: 0.64 },
  { key: 'v:<b>x</b>', label: '<b>x</b>', count: 250, share: 0.25 },
  { key: '', label: 'Not sent', muted: true, count: 10, share: 0.01 },
];

describe('ProportionBar', () => {
  it('labels every bar with its unit and offers the same rows as an accessible table', () => {
    render(
      <ProportionBar
        caption="Browser: share of page views"
        rows={ROWS}
        unit="page views"
        valueHeader="Browser"
      />,
    );
    const table = screen.getByRole('table', { name: 'Browser: share of page views' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(ROWS.length + 1);
    expect(within(rows[1]!).getByRole('cell', { name: 'Chrome' })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('cell', { name: '64% of page views' })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('cell', { name: '640' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Browser' })).toBeInTheDocument();
    // The visual bars print the unit too (decorative for assistive tech: the table says it).
    expect(screen.getAllByText('64% of page views')).toHaveLength(2);
    // Ingested text stays text.
    expect(screen.getAllByText('<b>x</b>').length).toBeGreaterThan(0);
  });

  it('sizes each bar by its share of the whole total', () => {
    const { container } = render(
      <ProportionBar caption="Browsers" rows={ROWS} unit="requests" valueHeader="Browser" />,
    );
    const fills = [...container.querySelectorAll<HTMLElement>('ol [style]')];
    expect(fills.map((fill) => fill.style.width)).toEqual(['64%', '25%', '1%']);
  });
});

describe('ProportionTable', () => {
  it('renders a plain table of every row', () => {
    render(<ProportionTable caption="All" rows={ROWS} unit="requests" valueHeader="Value" />);
    const table = screen.getByRole('table', { name: 'All' });
    expect(within(table).getByText('1% of requests')).toBeInTheDocument();
    expect(within(table).getByText('Not sent')).toBeInTheDocument();
  });
});
