import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CheckRow } from './CheckRow';

function renderRow(props: Partial<Parameters<typeof CheckRow>[0]> = {}) {
  return render(
    <ul>
      <CheckRow
        id="row"
        state="warn"
        stateLabel="Needs attention"
        title="EBO Sales"
        summary="No recent events"
        {...props}
      />
    </ul>,
  );
}

describe('CheckRow', () => {
  it('shows the mark label, title, summary and action as one list item', () => {
    const { container } = renderRow({ action: <a href="/fix">How to fix</a> });
    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('data-state', 'warn');
    expect(row).toHaveClass('border-l-3', 'border-l-warning');
    expect(screen.getByText('Needs attention')).toHaveClass('max-sm:sr-only');
    expect(container.querySelector('svg')).toHaveClass('text-warning');
    expect(screen.getByText('EBO Sales')).toBeInTheDocument();
    expect(screen.getByText('No recent events')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to fix' })).toHaveAttribute('href', '/fix');
  });

  it('has no toggle without details', () => {
    renderRow({ state: 'fail', stateLabel: 'Action needed' });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('listitem')).toHaveClass('border-l-destructive');
  });

  it('opens and closes the details with aria-expanded and aria-controls', async () => {
    const user = userEvent.setup();
    renderRow({ name: 'EBO Sales', children: <p>Counters</p> });
    const toggle = screen.getByRole('button', { name: 'Show details for EBO Sales' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'row-details');
    expect(screen.queryByText('Counters')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide details');
    const region = screen.getByRole('region', { name: 'EBO Sales' });
    expect(region).toHaveAttribute('id', 'row-details');
    expect(region).toHaveTextContent('Counters');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Counters')).toBeNull();
  });

  it('starts open with defaultOpen and names the region by the title without a name', () => {
    renderRow({ state: 'pass', stateLabel: 'Healthy', defaultOpen: true, children: <p>SDKs</p> });
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('region', { name: 'EBO Sales' })).toHaveTextContent('SDKs');
  });
});
