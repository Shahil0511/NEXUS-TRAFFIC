import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ErrorCodesList } from './ErrorCodesList';

const ITEMS = [
  { errorCode: 'QUERY_TIMEOUT', count: 1_200, routes: 3 },
  { errorCode: null, count: 40, routes: 1 },
  { errorCode: 'SERVICE_UNAVAILABLE', count: 7, routes: 1 },
];

describe('ErrorCodesList', () => {
  it('ranks codes with their counts and routes; "no code" is text, not a button', () => {
    render(<ErrorCodesList items={ITEMS} selected={undefined} onSelect={() => undefined} />);
    const list = screen.getByRole('list', { name: 'Error codes' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('QUERY_TIMEOUT')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('3 routes')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('No code sent')).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[2]!).getByText('1 route')).toBeInTheDocument();
  });

  it('calls onSelect with the code and marks the selected one as pressed', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ErrorCodesList items={ITEMS} selected="SERVICE_UNAVAILABLE" onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: /^QUERY_TIMEOUT/ }));
    expect(onSelect).toHaveBeenCalledWith('QUERY_TIMEOUT');
    expect(screen.getByRole('button', { name: /^SERVICE_UNAVAILABLE/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^QUERY_TIMEOUT/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows an empty state when nothing failed', () => {
    render(<ErrorCodesList items={[]} selected={undefined} onSelect={() => undefined} />);
    expect(screen.getByText('No error codes')).toBeInTheDocument();
  });
});
