import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { EnvironmentSelect } from './EnvironmentSelect';

describe('EnvironmentSelect', () => {
  it('reads "Production" by default (no ?env= in the URL)', () => {
    renderWithProviders(<EnvironmentSelect />);
    expect(screen.getByRole('combobox', { name: 'Environment filter' })).toHaveTextContent(
      'Production',
    );
  });

  it('puts a non-production choice in the URL', async () => {
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<EnvironmentSelect />, {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });

    await user.click(screen.getByRole('combobox', { name: 'Environment filter' }));
    await user.click(await screen.findByRole('option', { name: 'Staging' }));

    expect(urls.at(-1)).toContain('env=staging');
    expect(screen.getByRole('combobox', { name: 'Environment filter' })).toHaveTextContent(
      'Staging',
    );
  });

  it('clears ?env= when production is picked again', async () => {
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<EnvironmentSelect />, {
      searchParams: '?env=all',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(screen.getByRole('combobox', { name: 'Environment filter' })).toHaveTextContent(
      'All environments',
    );

    await user.click(screen.getByRole('combobox', { name: 'Environment filter' }));
    await user.click(await screen.findByRole('option', { name: 'Production' }));

    expect(urls.at(-1)).not.toContain('env=');
  });

  it('ignores an unknown ?env= value (falls back to production)', () => {
    renderWithProviders(<EnvironmentSelect />, { searchParams: '?env=qa' });
    expect(screen.getByRole('combobox', { name: 'Environment filter' })).toHaveTextContent(
      'Production',
    );
  });
});
