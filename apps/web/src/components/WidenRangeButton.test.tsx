import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAGES } from '@/lib/pages';
import { renderWithProviders } from '@/test/render';

import { WidenRangeButton, widerRange } from './WidenRangeButton';

const navigation = vi.hoisted(() => ({ pathname: '/users' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

afterEach(() => {
  navigation.pathname = PAGES.users();
});

describe('widerRange', () => {
  it('steps to the next preset of a week or more that the page accepts', () => {
    expect(widerRange({ range: '15m' }, MAX_PERCENTILE_RANGE_MS)).toBe('7d');
    expect(widerRange({ range: '24h' }, MAX_PERCENTILE_RANGE_MS)).toBe('7d');
    expect(widerRange({ range: '7d' }, MAX_PERCENTILE_RANGE_MS)).toBe('30d');
    expect(widerRange({ range: '30d' }, MAX_PERCENTILE_RANGE_MS)).toBeNull();
  });

  it('offers 90 days where the page accepts it (count pages), nothing past that', () => {
    expect(widerRange({ range: '30d' }, MAX_COUNT_RANGE_MS)).toBe('90d');
    expect(widerRange({ range: '30d' })).toBe('90d');
    expect(widerRange({ range: '90d' }, MAX_COUNT_RANGE_MS)).toBeNull();
  });

  it('measures a custom range from its bounds', () => {
    expect(
      widerRange({
        range: 'custom',
        from: '2026-10-01T09:00:00+05:30',
        to: '2026-10-01T18:00:00+05:30',
      }),
    ).toBe('7d');
    expect(
      widerRange({
        range: 'custom',
        from: '2026-09-01T00:00:00+05:30',
        to: '2026-09-20T00:00:00+05:30',
      }),
    ).toBe('30d');
    expect(
      widerRange(
        { range: 'custom', from: '2026-09-01T00:00:00+05:30', to: '2026-10-01T12:00:00+05:30' },
        MAX_PERCENTILE_RANGE_MS,
      ),
    ).toBeNull();
    expect(widerRange({ range: 'custom', from: 'nope', to: 'nope' })).toBe('7d');
  });
});

describe('WidenRangeButton', () => {
  it('offers the last 7 days for a short range and sets it in the URL', async () => {
    const urls: string[] = [];
    renderWithProviders(<WidenRangeButton />, {
      searchParams: '?range=1h&app=ebo-sales',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the last 7 days' }));
    expect(urls.at(-1)).toContain('range=7d');
    expect(urls.at(-1)).toContain('app=ebo-sales');
  });

  it('offers the last 90 days from 30 days on a count page (Users)', () => {
    navigation.pathname = PAGES.users();
    renderWithProviders(<WidenRangeButton />, { searchParams: '?range=30d' });
    expect(screen.getByRole('button', { name: 'Show the last 90 days' })).toBeInTheDocument();
  });

  it('links to Integration health once no wider preset fits the page (30 days on Overview)', () => {
    navigation.pathname = PAGES.overview();
    renderWithProviders(<WidenRangeButton />, { searchParams: '?range=30d&app=ebo-sales' });
    expect(screen.queryByRole('button')).toBeNull();
    const link = screen.getByRole('link', {
      name: /Is this app sending data\?.*Integration health/,
    });
    expect(link).toHaveAttribute('href', `${PAGES.integration()}?app=ebo-sales&range=30d`);
  });

  it('links to Integration health at 90 days on a count page', () => {
    navigation.pathname = PAGES.geography();
    renderWithProviders(<WidenRangeButton />, { searchParams: '?range=90d' });
    expect(screen.getByRole('link', { name: /Integration health/ })).toBeInTheDocument();
  });

  it('renders nothing on a page without a time range', () => {
    navigation.pathname = PAGES.live();
    const { container } = renderWithProviders(<WidenRangeButton />, { searchParams: '?range=1h' });
    expect(container).toBeEmptyDOMElement();
  });
});
