import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { TOOL_ID, TOOL_USAGE, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { ToolsView } from './ToolsView';

describe('ToolsView', () => {
  it('renders uses, distinct users, sessions and a described trend per tool', async () => {
    server.use(http.get(routeUrl(ROUTES.tools.usage), () => HttpResponse.json(TOOL_USAGE)));
    renderWithProviders(<ToolsView />);

    const table = await screen.findByRole('table', { name: 'Tools' });
    expect(await within(table).findByText('1,250')).toBeInTheDocument();
    expect(within(table).getByText('34')).toBeInTheDocument();
    expect(within(table).getByText('80')).toBeInTheDocument();
    expect(
      within(table).getByRole('img', { name: 'export-csv: uses per hourly bucket, 3 to 40' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tools by distinct users' })).toHaveTextContent(
      'export-csv',
    );
    const nav = screen.getByRole('navigation', { name: 'Pages and tools' });
    expect(within(nav).getByRole('link', { name: 'Tools' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows an empty state when no tool was used', async () => {
    server.use(
      http.get(routeUrl(ROUTES.tools.usage), () =>
        HttpResponse.json({ window: WINDOW, items: [] }),
      ),
    );
    renderWithProviders(<ToolsView />, { searchParams: '?range=7d' });
    expect(await screen.findByText('No tool usage in this window')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the last 30 days' })).toBeInTheDocument();
  });

  it('notes a capped list and filters the loaded rows by tool name', async () => {
    const base = TOOL_USAGE.items[0]!;
    const items = Array.from({ length: 100 }, (_, index) => ({
      ...base,
      toolId: index === 0 ? TOOL_ID : `${TOOL_ID.slice(0, -3)}${String(index).padStart(3, '0')}`,
      tool: index === 0 ? 'export-csv' : `tool-${index}`,
    }));
    server.use(
      http.get(routeUrl(ROUTES.tools.usage), () => HttpResponse.json({ window: WINDOW, items })),
    );
    renderWithProviders(<ToolsView />);
    expect(
      await screen.findByText('Most used first · Showing the top 100 tools — there may be more'),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Tools' });
    await userEvent
      .setup()
      .type(screen.getByRole('searchbox', { name: /filter loaded tools/i }), 'export');
    expect(within(table).getByText('export-csv')).toBeInTheDocument();
    expect(within(table).queryByText('tool-7')).toBeNull();
    expect(screen.getByText('1 of 100 loaded tools match')).toBeInTheDocument();
  });

  it('"Clear filter" restores every row and puts focus back in the search box', async () => {
    server.use(http.get(routeUrl(ROUTES.tools.usage), () => HttpResponse.json(TOOL_USAGE)));
    renderWithProviders(<ToolsView />);
    const table = await screen.findByRole('table', { name: 'Tools' });
    expect(await within(table).findByText('1,250')).toBeInTheDocument();
    const user = userEvent.setup();
    const search = screen.getByRole('searchbox', { name: /filter loaded tools/i });
    await user.type(search, 'nope');
    expect(screen.getByText('No loaded tools match this filter')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(within(table).getByText('1,250')).toBeInTheDocument();
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
  });
});
