import { ROUTES, type PageStatsDto } from '@nexus/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { cappedListNote, FilterMatchCount, filterLoadedRows } from '@/components/LoadedRowsFilter';
import { formatInteger } from '@/lib/format';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { PAGE_ID, PAGE_STATS, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { longestMedianPages } from './pagesHeadline';
import { PagesView } from './PagesView';

/** The headline sentence: the hero paragraph that starts with the page count. */
function headline(start: RegExp): HTMLElement {
  return screen.getByText(
    (_, element) => element?.tagName === 'P' && start.test(element.textContent ?? ''),
  );
}

/** The page template of each body row, top to bottom. */
function rowTemplates(table: HTMLElement): (string | null)[] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('link')[0]!.getAttribute('aria-label'));
}

function servePages(body = PAGE_STATS, seen: URLSearchParams[] = []) {
  server.use(
    http.get(routeUrl(ROUTES.pages.list), ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
  return seen;
}

describe('PagesView', () => {
  it('opens with a sentence naming the longest page and the top exit, and no chart panels', async () => {
    const seen = servePages();
    renderWithProviders(<PagesView />, { searchParams: '?app=ebo-sales&range=7d' });

    const table = await screen.findByRole('table', { name: 'Pages' });
    expect(await within(table).findByText('420')).toBeInTheDocument();
    expect(within(table).getByText('48.00 s')).toBeInTheDocument();
    expect(within(table).getByText('31.00 s')).toBeInTheDocument();
    expect(within(table).getByText('25.0%')).toBeInTheDocument();
    expect(seen[0]?.get('app')).toBe('ebo-sales');
    expect(seen[0]?.get('range')).toBe('7d');

    const sentence = headline(/^2 pages viewed/);
    expect(sentence).toHaveTextContent(
      '2 pages viewed 432 times in this range. People look longest at /orders/:id (median 31.00 s). Most visits end on /orders/:id (50 visits).',
    );
    const href = withQuery(PAGES.pageDetail('ebo-sales', PAGE_ID), {
      app: 'ebo-sales',
      range: '7d',
    });
    const links = within(sentence).getAllByRole('link', { name: '/orders/:id' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([href, href]);
    expect(sentence).toHaveClass('break-words');

    // The chart and the exit list above the table are gone.
    expect(screen.queryByText('Time on page')).toBeNull();
    expect(screen.queryByText('Exit pages')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Exit pages' })).toBeNull();

    // The Pages / Features / Request types tab row keeps the filters.
    const nav = screen.getByRole('navigation', { name: 'Pages, features and request types' });
    expect(within(nav).getByRole('link', { name: 'Pages' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Features' }).getAttribute('href')).toBe(
      '/tools?app=ebo-sales&range=7d',
    );
    expect(within(nav).getByRole('link', { name: 'Request types' }).getAttribute('href')).toBe(
      '/endpoints?app=ebo-sales&range=7d',
    );
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('has a People column after Visits, and every number column sorts', async () => {
    servePages();
    renderWithProviders(<PagesView />);
    const table = await screen.findByRole('table', { name: 'Pages' });
    expect(await within(table).findByText('64')).toBeInTheDocument();
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      'Page',
      'Views',
      'Visits',
      'People',
      'Average visible',
      'Median visible',
      'Exits',
    ]);
    expect(within(table).getByRole('button', { name: 'What is People?' })).toBeInTheDocument();
    const sortButtons = within(table)
      .getAllByRole('button')
      .filter((button) => !button.hasAttribute('aria-label'))
      .map((button) => button.textContent);
    expect(sortButtons).toEqual(headers.slice(1));
    expect(screen.getByText('Sorted by views, most first')).toBeInTheDocument();
  });

  it('a header click writes ?sort and reorders the loaded rows without a new request', async () => {
    const seen = servePages();
    const urls: string[] = [];
    renderWithProviders(<PagesView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(rowTemplates(table)).toEqual(['/orders/:id', '/reports']);

    const user = userEvent.setup();
    await user.click(within(table).getByRole('button', { name: 'People' }));
    expect(urls.at(-1)).toContain('sort=people');
    // The default direction (most first) stays out of the URL.
    expect(urls.at(-1)).not.toContain('dir=');
    expect(rowTemplates(table)).toEqual(['/orders/:id', '/reports']);

    await user.click(within(table).getByRole('button', { name: 'People' }));
    expect(urls.at(-1)).toContain('dir=asc');
    expect(rowTemplates(table)).toEqual(['/reports', '/orders/:id']);
    expect(screen.getByText('Sorted by people, fewest first')).toBeInTheDocument();
    expect(
      within(table)
        .getByRole('columnheader', { name: /People/ })
        .getAttribute('aria-sort'),
    ).toBe('ascending');

    // Pages without a measured visible time stay last, whichever way.
    await user.click(within(table).getByRole('button', { name: 'Median visible' }));
    expect(rowTemplates(table)).toEqual(['/orders/:id', '/reports']);
    await user.click(within(table).getByRole('button', { name: 'Median visible' }));
    expect(rowTemplates(table)).toEqual(['/orders/:id', '/reports']);
    expect(seen).toHaveLength(1);
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('an unknown ?sort= falls back to most viewed first', async () => {
    servePages();
    renderWithProviders(<PagesView />, { searchParams: '?sort=nonsense&dir=sideways' });
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(rowTemplates(table)).toEqual(['/orders/:id', '/reports']);
    expect(screen.getByText('Sorted by views, most first')).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: /Views/ }).getAttribute('aria-sort'),
    ).toBe('descending');
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('a shared link sorted by exits ascending is kept', async () => {
    servePages();
    renderWithProviders(<PagesView />, { searchParams: '?sort=exits&dir=asc' });
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(rowTemplates(table)).toEqual(['/reports', '/orders/:id']);
    expect(screen.getByText('Sorted by exits, fewest first')).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('notes a capped list, words the sentence as a bound and says sorting covers the loaded rows', async () => {
    const base = PAGE_STATS.items[0]!;
    const items: PageStatsDto[] = Array.from({ length: 100 }, (_, index) => ({
      ...base,
      pageId: `${PAGE_ID.slice(0, -3)}${String(index).padStart(3, '0')}`,
      pathTemplate: `/page-${index}`,
    }));
    servePages({ window: WINDOW, items });
    renderWithProviders(<PagesView />);
    expect(
      await screen.findByText(
        'Sorted by views, most first · Showing the top 100 pages — there may be more; sorting covers the loaded rows',
      ),
    ).toBeInTheDocument();
    expect(headline(/^The 100 most viewed pages/)).toHaveTextContent(
      `The 100 most viewed pages were viewed ${formatInteger(42_000)} times in this range.`,
    );
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows the empty state with a wider range and the guide when the window has no page views', async () => {
    servePages({ window: WINDOW, items: [] });
    renderWithProviders(<PagesView />);
    expect(await screen.findByText('No page views in this window')).toBeInTheDocument();
    expect(headline(/^No page was/)).toHaveTextContent('No page was viewed in this range.');
    // The default range (24h) widens to a week in one click.
    expect(screen.getAllByRole('button', { name: 'Show the last 7 days' }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('link', { name: 'Integration guide' })).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
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
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('keeps the integration guide on the page when pages exist but none has a measured visible time', async () => {
    servePages({ window: WINDOW, items: [PAGE_STATS.items[1]!] });
    renderWithProviders(<PagesView />);
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(headline(/^1 page viewed/)).toHaveTextContent(
      "1 page viewed 12 times in this range. No visible time measured yet: it appears once the app's browser tracker sends it.",
    );
    expect(screen.getByRole('link', { name: 'Integration guide' })).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows no extra guide link once a page has a measured visible time', async () => {
    servePages();
    renderWithProviders(<PagesView />);
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(screen.queryByRole('link', { name: 'Integration guide' })).toBeNull();
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

  it('the sentence names only a page with a measured visible time as the longest', async () => {
    expect(longestMedianPages(PAGE_STATS.items)).toEqual([PAGE_STATS.items[0]]);
    // /reports has no measured time, so it never becomes "the longest" even when it is the only
    // page with more exits.
    const reports = { ...PAGE_STATS.items[1]!, exits: 70 };
    servePages({ window: WINDOW, items: [PAGE_STATS.items[0]!, reports] });
    renderWithProviders(<PagesView />);
    const table = await screen.findByRole('table', { name: 'Pages' });
    await within(table).findByText('/reports');
    expect(headline(/^2 pages viewed/)).toHaveTextContent(
      'People look longest at /orders/:id (median 31.00 s). Most visits end on /reports (70 visits).',
    );
  });
});
