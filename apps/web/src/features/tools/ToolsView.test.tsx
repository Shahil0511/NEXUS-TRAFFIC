import { ROUTES, type ToolUsageDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { formatInteger } from '@/lib/format';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { TOOL_ID, TOOL_USAGE, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { ToolsView } from './ToolsView';

const EXPORT: ToolUsageDto = TOOL_USAGE.items[0]!;
const FILTER: ToolUsageDto = {
  ...EXPORT,
  toolId: '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6f',
  tool: 'date-filter',
  uses: 300,
  distinctUsers: 50,
};

/** The headline sentence: the hero paragraph that starts with the feature count. */
function headline(start: RegExp): HTMLElement {
  return screen.getByText(
    (_, element) => element?.tagName === 'P' && start.test(element.textContent ?? ''),
  );
}

/** The feature name of each body row, top to bottom. */
function rowNames(table: HTMLElement): (string | null)[] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('link')[0]!.textContent);
}

function serveTools(items: readonly ToolUsageDto[] = TOOL_USAGE.items) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.tools.usage), ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ window: WINDOW, items });
    }),
  );
  return seen;
}

describe('ToolsView', () => {
  it('renders uses, people and visits per feature, with the trend under its name', async () => {
    serveTools();
    renderWithProviders(<ToolsView />);

    const table = await screen.findByRole('table', { name: 'Features' });
    expect(await within(table).findByText('1,250')).toBeInTheDocument();
    expect(within(table).getByText('34')).toBeInTheDocument();
    expect(within(table).getByText('80')).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Feature', 'Uses', 'People', 'Visits', 'Last used']);
    expect(within(table).getByRole('button', { name: 'What is People?' })).toBeInTheDocument();
    // The sparkline sits in the first column, under the name (no separate Trend column).
    const firstCell = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell')[0]!;
    expect(
      within(firstCell).getByRole('img', { name: 'export-csv: uses per hourly bucket, 3 to 40' }),
    ).toBeInTheDocument();
    expect(within(firstCell).getByRole('link', { name: 'export-csv' })).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Pages, features and request types' });
    expect(within(nav).getByRole('link', { name: 'Features' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Request types' }).getAttribute('href')).toBe(
      '/endpoints',
    );
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('opens with a sentence naming the most used feature and the widest reach, and no chart panels', async () => {
    serveTools([EXPORT, FILTER]);
    renderWithProviders(<ToolsView />, { searchParams: '?app=ebo-sales&range=7d' });
    const table = await screen.findByRole('table', { name: 'Features' });
    await within(table).findByText('date-filter');
    const linkQuery = { app: 'ebo-sales', range: '7d' };

    const sentence = headline(/^2 features used/);
    expect(sentence).toHaveTextContent(
      '2 features used 1,550 times in this range. Most used: export-csv (1,250 uses). Used by the most people: date-filter (50 verified people).',
    );
    expect(within(sentence).getByRole('link', { name: 'export-csv' })).toHaveAttribute(
      'href',
      withQuery(PAGES.toolDetail('ebo-sales', TOOL_ID), linkQuery),
    );
    expect(within(sentence).getByRole('link', { name: 'date-filter' })).toHaveAttribute(
      'href',
      withQuery(PAGES.toolDetail('ebo-sales', FILTER.toolId), linkQuery),
    );
    expect(sentence).toHaveClass('break-words');
    expect(screen.queryByText('Most used tools')).toBeNull();
    expect(screen.queryByText('Widest reach')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Tools by distinct users' })).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('a People header click writes ?sort and reorders the loaded rows without a new request', async () => {
    const seen = serveTools([EXPORT, FILTER]);
    const urls: string[] = [];
    renderWithProviders(<ToolsView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    const table = await screen.findByRole('table', { name: 'Features' });
    await within(table).findByText('date-filter');
    expect(rowNames(table)).toEqual(['export-csv', 'date-filter']);
    expect(screen.getByText('Sorted by uses, most first')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(table).getByRole('button', { name: 'People' }));
    expect(urls.at(-1)).toContain('sort=people');
    expect(rowNames(table)).toEqual(['date-filter', 'export-csv']);
    expect(screen.getByText('Sorted by people, most first')).toBeInTheDocument();
    expect(
      within(table)
        .getByRole('columnheader', { name: /People/ })
        .getAttribute('aria-sort'),
    ).toBe('descending');
    expect(seen).toHaveLength(1);
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('an unknown ?sort= falls back to most used first', async () => {
    serveTools([FILTER, EXPORT]);
    renderWithProviders(<ToolsView />, { searchParams: '?sort=views&dir=up' });
    const table = await screen.findByRole('table', { name: 'Features' });
    await within(table).findByText('date-filter');
    expect(rowNames(table)).toEqual(['export-csv', 'date-filter']);
    expect(screen.getByText('Sorted by uses, most first')).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows an empty state when no feature was used', async () => {
    serveTools([]);
    renderWithProviders(<ToolsView />, { searchParams: '?range=7d' });
    expect(await screen.findByText('No feature usage in this window')).toBeInTheDocument();
    expect(headline(/^No feature was/)).toHaveTextContent('No feature was used in this range.');
    expect(screen.getByRole('button', { name: 'Show the last 30 days' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Integration guide' })).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('notes a capped list, words the sentence as a bound and filters the loaded rows by name on the client only', async () => {
    const base = TOOL_USAGE.items[0]!;
    const items = Array.from({ length: 100 }, (_, index) => ({
      ...base,
      toolId: index === 0 ? TOOL_ID : `${TOOL_ID.slice(0, -3)}${String(index).padStart(3, '0')}`,
      tool: index === 0 ? 'export-csv' : `tool-${index}`,
    }));
    const seen = serveTools(items);
    const urls: string[] = [];
    renderWithProviders(<ToolsView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    expect(
      await screen.findByText(
        'Sorted by uses, most first · Showing the top 100 features — there may be more; sorting covers the loaded rows',
      ),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Features' });
    await userEvent
      .setup()
      .type(screen.getByRole('searchbox', { name: /filter loaded features/i }), 'export');
    expect(within(table).getByText('export-csv')).toBeInTheDocument();
    expect(within(table).queryByText('tool-7')).toBeNull();
    expect(screen.getByText('1 of 100 loaded features match')).toBeInTheDocument();
    expect(headline(/^The 100 most used features/)).toHaveTextContent(
      `The 100 most used features were used ${formatInteger(125_000)} times in this range.`,
    );
    // The filter text never reaches the API or the URL.
    expect(seen).toHaveLength(1);
    expect(urls).toEqual([]);
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('"Clear filter" restores every row and puts focus back in the search box', async () => {
    serveTools();
    renderWithProviders(<ToolsView />);
    const table = await screen.findByRole('table', { name: 'Features' });
    expect(await within(table).findByText('1,250')).toBeInTheDocument();
    const user = userEvent.setup();
    const search = screen.getByRole('searchbox', { name: /filter loaded features/i });
    await user.type(search, 'nope');
    expect(screen.getByText('No loaded features match this filter')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(within(table).getByText('1,250')).toBeInTheDocument();
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});
