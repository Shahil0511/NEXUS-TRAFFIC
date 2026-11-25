import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FactSheet, NOT_CAPTURED } from './FactSheet';

describe('FactSheet', () => {
  it('renders a named description list: label, bold value, note, (i) beside the label', () => {
    render(
      <FactSheet
        ariaLabel="Page facts"
        facts={[
          { label: 'Views', value: '420', info: 'How many times a page was opened.' },
          { label: 'People', value: '64', note: 'verified' },
        ]}
      />,
    );
    const list = screen.getByLabelText('Page facts');
    expect(list.tagName).toBe('DL');
    expect(list).toHaveClass('flex', 'flex-wrap');
    const terms = within(list).getAllByRole('term');
    expect(terms.map((term) => term.textContent)).toEqual(['Views', 'People']);
    expect(within(terms[0]!).getByRole('button', { name: 'What is Views?' })).toBeInTheDocument();
    expect(within(list).getByText('420')).toHaveClass('font-semibold', 'tabular');
    expect(within(list).getByText('verified')).toHaveClass('text-muted-foreground');
  });

  it('links a value with href (text-link), and says "not captured" for a missing value', () => {
    render(
      <FactSheet
        ariaLabel="Facts"
        facts={[
          { label: 'App', value: 'EBO Sales', href: '/applications/ebo-sales' },
          { label: 'Median visible', value: null },
          { label: 'Average visible', value: undefined },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'EBO Sales' });
    expect(link).toHaveAttribute('href', '/applications/ebo-sales');
    expect(link).toHaveClass('text-link');
    const missing = screen.getAllByText(NOT_CAPTURED);
    expect(missing).toHaveLength(2);
    expect(missing[0]).toHaveClass('text-muted-foreground');
  });

  it('drops the note of a missing value: the line reads only "not captured"', () => {
    render(
      <FactSheet
        ariaLabel="Facts"
        facts={[{ label: 'Exit rate', value: null, note: '0 visits ended here' }]}
      />,
    );
    const value = screen.getByRole('definition');
    expect(value).toHaveTextContent(/^not captured$/);
    expect(screen.queryByText('0 visits ended here')).not.toBeInTheDocument();
  });

  it('stacks one fact per row with the value on the right', () => {
    render(
      <FactSheet ariaLabel="Facts" layout="stack" facts={[{ label: 'Visits', value: '2' }]} />,
    );
    const list = screen.getByLabelText('Facts');
    expect(list).not.toHaveClass('flex-wrap');
    const row = list.querySelector('[data-slot="fact"]');
    expect(row).toHaveClass('justify-between');
    expect(within(list).getByRole('definition')).toHaveClass('text-right');
  });
});
