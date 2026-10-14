import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  p95: number;
}

const COLUMNS: DataTableColumn<Row, 'p95'>[] = [
  { id: 'id', header: 'Route', cell: (row) => row.id },
  {
    id: 'p95',
    header: 'p95',
    sortKey: 'p95',
    align: 'right',
    hint: '95 % of calls were faster.',
    cell: (row) => `${row.p95} ms`,
  },
];

describe('DataTable column hints', () => {
  it('puts the (i) beside the sort button, both usable', async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        caption="Routes"
        columns={COLUMNS}
        rows={[{ id: '/a', p95: 840 }]}
        rowKey={(row) => row.id}
        sort={{ sort: 'p95', dir: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    // The column's name comes first: it is announced with every cell of the column.
    const header = screen.getByRole('columnheader', { name: /^p95/ });
    const sortButton = within(header).getByRole('button', { name: 'p95' });
    const info = within(header).getByRole('button', { name: 'What is p95?' });
    expect(sortButton).not.toContainElement(info);

    await user.click(sortButton);
    expect(onSortChange).toHaveBeenCalledWith({ sort: 'p95', dir: 'asc' });

    await user.click(info);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('95 % of calls were faster.');
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it('leaves headers without a hint untouched', () => {
    render(<DataTable caption="Routes" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} />);
    expect(screen.getByRole('columnheader', { name: 'Route' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What is Route?' })).not.toBeInTheDocument();
  });
});
