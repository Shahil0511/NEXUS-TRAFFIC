import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BREAKDOWN } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { BreakdownPanel, breakdownItems } from './BreakdownPanel';

describe('BreakdownPanel', () => {
  it('asks for the dimension and source it shows, with the page filters', async () => {
    let seen: URLSearchParams | undefined;
    server.use(
      http.get(routeUrl(ROUTES.overview.breakdown), ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ ...BREAKDOWN, source: 'server', dimension: 'release' });
      }),
    );
    renderWithProviders(
      <BreakdownPanel
        title="API releases"
        source="server"
        dimensions={['release']}
        filters={{ range: '24h', app: 'ebo-sales', env: 'all' }}
      />,
    );
    const list = await screen.findByRole('list', { name: 'API releases by release' });
    expect(within(list).getByText('Chrome')).toBeInTheDocument();
    expect(Object.fromEntries(seen!)).toEqual({
      range: '24h',
      app: 'ebo-sales',
      env: 'all',
      source: 'server',
      dimension: 'release',
      limit: '8',
    });
    // A single dimension needs no picker.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('says so when the dimension has no data in the window', async () => {
    server.use(
      http.get(routeUrl(ROUTES.overview.breakdown), () =>
        HttpResponse.json({ ...BREAKDOWN, dimension: 'client_lang', items: [], total: 0 }),
      ),
    );
    renderWithProviders(
      <BreakdownPanel title="Languages" dimensions={['client_lang']} filters={{ range: '24h' }} />,
    );
    expect(await screen.findByText('No language data in this window')).toBeInTheDocument();
  });
});

describe('breakdownItems', () => {
  it('keys a null value apart and states each share of the whole window', () => {
    const items = breakdownItems(BREAKDOWN);
    expect(items.map((item) => item.key)).toEqual(['Chrome', 'Safari', '']);
    expect(items[0]?.sublabel).toBe('64.0% of 1,000 events');
    expect(items.map((item) => item.value)).toEqual([640, 250, 10]);
  });
});
