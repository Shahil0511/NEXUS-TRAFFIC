import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { screen } from '@testing-library/react';
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
