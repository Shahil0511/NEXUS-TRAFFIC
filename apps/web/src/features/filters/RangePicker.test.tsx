import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { presetOptions, RangePicker } from './RangePicker';

describe('presetOptions', () => {
  it('disables presets longer than the page accepts, saying why', () => {
    const percentile = presetOptions(MAX_PERCENTILE_RANGE_MS);
    expect(percentile.find((o) => o.value === '90d')).toMatchObject({
      disabled: true,
      disabledReason: 'this page covers at most 31 days',
    });
    expect(percentile.find((o) => o.value === '30d')?.disabled).toBe(false);
    expect(presetOptions(MAX_COUNT_RANGE_MS).every((o) => !o.disabled)).toBe(true);
  });
});

describe('RangePicker', () => {
  it('renders a too-long preset as a disabled button', () => {
    renderWithProviders(<RangePicker maxRangeMs={MAX_PERCENTILE_RANGE_MS} />);
    expect(screen.getByRole('radio', { name: /Last 90 days/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toBeEnabled();
  });
});

describe('RangePicker compact select', () => {
  it('changes the range from the dropdown shown below xl', async () => {
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<RangePicker />, { onUrlUpdate: (event) => urls.push(event.queryString) });

    await user.click(screen.getByRole('combobox', { name: 'Time range' }));
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }));

    expect(urls.at(-1)).toContain('range=7d');
    expect(screen.getByRole('combobox', { name: 'Time range' })).toHaveTextContent('Last 7 days');
  });

  it('lists a too-long preset as disabled with its reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RangePicker maxRangeMs={MAX_PERCENTILE_RANGE_MS} />);

    await user.click(screen.getByRole('combobox', { name: 'Time range' }));
    const tooLong = await screen.findByRole('option', {
      name: 'Last 90 days (this page covers at most 31 days)',
    });
    expect(tooLong).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Last 30 days' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('reads "Custom" while a custom window is active', () => {
    renderWithProviders(<RangePicker />, {
      searchParams: '?range=custom&from=2026-10-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z',
    });
    expect(screen.getByRole('combobox', { name: 'Time range' })).toHaveTextContent('Custom');
    expect(screen.getByRole('button', { name: /^Custom range:/ })).toBeInTheDocument();
  });
});
