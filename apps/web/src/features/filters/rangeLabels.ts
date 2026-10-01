import type { RangePreset } from '@nexus/shared';

/** Short button label + accessible name of every RANGE_VALUES preset. */
export const RANGE_LABELS: Record<RangePreset, { label: string; ariaLabel: string }> = {
  '15m': { label: '15m', ariaLabel: 'Last 15 minutes' },
  '1h': { label: '1h', ariaLabel: 'Last hour' },
  '6h': { label: '6h', ariaLabel: 'Last 6 hours' },
  '24h': { label: '24h', ariaLabel: 'Last 24 hours' },
  '7d': { label: '7d', ariaLabel: 'Last 7 days' },
  '30d': { label: '30d', ariaLabel: 'Last 30 days' },
  '90d': { label: '90d', ariaLabel: 'Last 90 days' },
  custom: { label: 'Custom', ariaLabel: 'Custom range' },
};
