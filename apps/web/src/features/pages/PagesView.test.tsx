import { ROUTES } from '@nexus/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { PAGE_STATS, WINDOW } from '@/test/fixtures';
import { cappedListNote, FilterMatchCount, filterLoadedRows } from '@/components/LoadedRowsFilter';
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
    // The default range (24h) widens to a week in one click.
    expect(screen.getAllByRole('button', { name: 'Show the last 7 days' }).length).toBeGreaterThan(
      0,
    );
  });

  it('filters the loaded rows by template on the client only (never sent to the API)', async () => {
    const seen: string[] = [];
    server.use(
      http.get(routeUrl(ROUTES.pages.list), ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json(PAGE_STATS);
      }),
    );
    const urls: string[] = [];
    renderWithProviders(<PagesView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    const table = await screen.findByRole('table', { name: 'Pages' });
    expect(await within(table).findByText('/reports')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: /filter loaded pages/i }), 'REPORT');
    expect(within(table).queryByText('/orders/:id')).toBeNull();
    expect(within(table).getByText('/reports')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 loaded pages match')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: /filter loaded pages/i }));
    await user.type(screen.getByRole('searchbox', { name: /filter loaded pages/i }), 'nope');
    expect(screen.getByText('No loaded pages match this filter')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(within(table).getByText('/orders/:id')).toBeInTheDocument();
    // The button unmounted with focus on it: focus goes back to the search box, not <body>.
    const search = screen.getByRole('searchbox', { name: /filter loaded pages/i });
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();

    expect(seen).toHaveLength(1);
    expect(urls).toEqual([]);
  });

  it('keeps the match-count live region mounted (empty) so its first update is announced', () => {
    const { rerender } = render(
      <FilterMatchCount active={false} shown={0} loaded={2} noun="pages" />,
    );
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    rerender(<FilterMatchCount active shown={1} loaded={2} noun="pages" />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('1 of 2 loaded pages match');
  });

  it('says neutrally that a list at the API limit may be cut (never claims "100+")', () => {
    expect(cappedListNote(100, 100, 'pages')).toBe('Showing the top 100 pages — there may be more');
    expect(cappedListNote(42, 100, 'pages')).toBeNull();
    expect(filterLoadedRows(PAGE_STATS.items, '  ', (page) => page.pathTemplate)).toBe(
      PAGE_STATS.items,
    );
  });

  it('charts only pages with a measured visible time, longest first', () => {
    const bars = longestMedianPages(PAGE_STATS.items);
    expect(bars).toEqual([{ key: 'ebo-sales|/orders/:id', label: '/orders/:id', value: 31_000 }]);
  });
});
