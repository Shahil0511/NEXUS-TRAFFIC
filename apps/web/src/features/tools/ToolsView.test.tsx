import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { TOOL_USAGE, WINDOW } from '@/test/fixtures';
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
    renderWithProviders(<ToolsView />);
    expect(await screen.findByText('No tool usage in this window')).toBeInTheDocument();
  });
});
