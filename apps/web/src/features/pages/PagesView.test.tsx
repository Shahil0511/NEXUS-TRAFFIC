import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { PAGE_STATS, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { longestMedianPages, PagesView } from './PagesView';

describe('PagesView', () => {
  it('renders time on page, views and exits per page template, with the filters forwarded', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.pages.list), ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(PAGE_STATS);
      }),
    );
    renderWithProviders(<PagesView />, { searchParams: '?app=ebo-sales&range=7d' });

    const table = await screen.findByRole('table', { name: 'Pages' });
    expect(await within(table).findByText('420')).toBeInTheDocument();
    expect(within(table).getByText('48.00 s')).toBeInTheDocument();
    expect(within(table).getByText('31.00 s')).toBeInTheDocument();
    expect(within(table).getByText('25.0%')).toBeInTheDocument();
    expect(seen[0]?.get('app')).toBe('ebo-sales');
    expect(seen[0]?.get('range')).toBe('7d');
    expect(screen.getByRole('list', { name: 'Exit pages' })).toHaveTextContent('/orders/:id');
    // The Pages / Tools switch keeps the filters.
    const nav = screen.getByRole('navigation', { name: 'Pages and tools' });
    expect(within(nav).getByRole('link', { name: 'Pages' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Tools' }).getAttribute('href')).toBe(
      '/tools?app=ebo-sales&range=7d',
    );
  });

  it('shows empty states when the window has no page views', async () => {
    server.use(
      http.get(routeUrl(ROUTES.pages.list), () => HttpResponse.json({ window: WINDOW, items: [] })),
    );
    renderWithProviders(<PagesView />);
    expect(await screen.findByText('No page views in this window')).toBeInTheDocument();
    expect(screen.getByText('No time measured')).toBeInTheDocument();
  });

  it('charts only pages with a measured visible time, longest first', () => {
    const bars = longestMedianPages(PAGE_STATS.items);
    expect(bars).toEqual([{ key: 'ebo-sales|/orders/:id', label: '/orders/:id', value: 31_000 }]);
  });
});
