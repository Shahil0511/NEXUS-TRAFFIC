import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PAGES } from '@/lib/pages';

import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('shows no (i) without `info`', () => {
    render(<KpiCard label="Requests" value="12.3K" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains the metric behind an (i) next to the label', async () => {
    const user = userEvent.setup();
    render(<KpiCard label="p95 latency" value="840 ms" info="95 % of calls were faster." />);
    expect(screen.getByRole('heading', { name: 'p95 latency' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What is p95 latency?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('95 % of calls were faster.');
  });

  it('keeps the (i) OUTSIDE the card link (no button inside a link)', () => {
    render(
      <KpiCard label="Error rate" value="2.5%" href={PAGES.errors()} info="Share of failures." />,
    );
    const link = screen.getByRole('link', { name: 'Error rate' });
    expect(link).toHaveAttribute('href', PAGES.errors());
    const info = screen.getByRole('button', { name: 'What is Error rate?' });
    expect(link).not.toContainElement(info);
    expect(within(link).queryByRole('button')).not.toBeInTheDocument();
  });
});
