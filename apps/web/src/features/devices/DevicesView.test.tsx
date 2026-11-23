import { BREAKDOWN_LIMIT_MAX, ROUTES, type BreakdownDto } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { BREAKDOWN, DEVICE_RETURN, GEO_CITIES, GEO_COUNTRIES, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { DIMENSION_TOP_N } from './DimensionSharePanel';
import { DevicesView } from './DevicesView';

/** Deployed reality on an internal network: traffic exists, none of it has a location. */
const UNLOCATED = {
  window: WINDOW,
  items: [{ country: null, requests: 1_500, pageViews: 120, users: 6 }],
};

interface Seen {
  breakdowns: Record<string, string>[];
  devices: number;
  countries: number;
}

/** MSW handlers for every read the page makes; the breakdown echoes the asked source + dimension. */
function mockReads(geo: { countries?: unknown } = {}): Seen {
  const seen: Seen = { breakdowns: [], devices: 0, countries: 0 };
  server.use(
    http.get(routeUrl(ROUTES.overview.breakdown), ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      seen.breakdowns.push(params);
      const body: BreakdownDto = {
        ...BREAKDOWN,
        source: params.source === 'server' ? 'server' : 'browser',
        dimension: params.dimension as BreakdownDto['dimension'],
      };
      return HttpResponse.json(body);
    }),
    http.get(routeUrl(ROUTES.overview.devices), () => {
      seen.devices += 1;
      return HttpResponse.json(DEVICE_RETURN);
    }),
    http.get(routeUrl(ROUTES.geo.countries), () => {
      seen.countries += 1;
      return HttpResponse.json(geo.countries ?? GEO_COUNTRIES);
    }),
    http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json(GEO_CITIES)),
  );
  return seen;
}

describe('DevicesView', () => {
  it('opens on "Devices & browsers" with shares of page views, each label carrying its unit', async () => {
    const seen = mockReads();
    renderWithProviders(<DevicesView />, { searchParams: '?app=ebo-sales&range=today' });

    expect(screen.getByRole('tab', { name: /Devices & browsers/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const browser = await screen.findByRole('region', { name: 'Browser' });
    const table = await within(browser).findByRole('table', {
      name: 'Browser: share of page views',
    });
    expect(within(table).getByRole('cell', { name: 'Chrome' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '64% of page views' })).toBeInTheDocument();
    // What the top list leaves out is one honest "All other values" bar (1,000 − 900).
    expect(within(table).getByRole('cell', { name: 'All other values' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '10% of page views' })).toBeInTheDocument();

    for (const title of ['Device type', 'Operating system', 'App version']) {
      expect(await screen.findByRole('region', { name: title })).toBeInTheDocument();
    }
    expect(
      await screen.findByRole('region', { name: 'First-time vs returning devices' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(seen.breakdowns).toHaveLength(4));
    expect(seen.breakdowns.map((q) => q.dimension).sort()).toEqual(
      ['browser', 'device', 'os', 'release'].sort(),
    );
    for (const query of seen.breakdowns) {
      expect(query).toMatchObject({
        app: 'ebo-sales',
        range: 'today',
        source: 'browser',
        limit: String(DIMENSION_TOP_N),
      });
    }
    expect(seen.devices).toBe(1);
    // The Places tab is not mounted, so it asks for nothing.
    expect(seen.countries).toBe(0);
  });

  it('switches every bar to requests (source=server) and keeps the choice in the URL', async () => {
    const seen = mockReads();
    const urls: string[] = [];
    renderWithProviders(<DevicesView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await screen.findByRole('table', { name: 'Browser: share of page views' });

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Requests (server events)' }));
    expect(urls.at(-1)).toContain('share=requests');
    const table = await screen.findByRole('table', { name: 'Browser: share of requests' });
    expect(within(table).getByRole('cell', { name: '64% of requests' })).toBeInTheDocument();
    expect(seen.breakdowns.some((q) => q.source === 'server' && q.dimension === 'browser')).toBe(
      true,
    );
    expect(
      screen.getByText('Every bar is a share of requests in the selected range.'),
    ).toBeInTheDocument();
  });

  it('greys out time zone and language for requests without asking the API, and offers page views', async () => {
    const seen = mockReads();
    const urls: string[] = [];
    renderWithProviders(<DevicesView />, {
      searchParams: '?tab=places&share=requests',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });

    expect(screen.getByRole('tab', { name: /Places/ })).toHaveAttribute('aria-selected', 'true');
    const timeZone = screen.getByRole('region', { name: 'Time zone' });
    expect(within(timeZone).getByText('Not available for requests')).toBeInTheDocument();
    const language = screen.getByRole('region', { name: 'Language' });
    expect(within(language).getByText('Not available for requests')).toBeInTheDocument();
    // Countries follow the share-of switch: no own "Rank countries by" control here.
    expect(await screen.findByText('Requests · top 10')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Rank countries by' })).toBeNull();
    expect(await screen.findByRole('table', { name: 'Countries' })).toBeInTheDocument();
    expect(seen.breakdowns).toHaveLength(0);

    await userEvent
      .setup()
      .click(within(timeZone).getByRole('button', { name: 'Show share of page views' }));
    // Page views is the default, so the param leaves the URL.
    expect(urls.at(-1)).not.toContain('share=');
    const tzTable = await screen.findByRole('table', { name: 'Time zone: share of page views' });
    expect(tzTable).toBeInTheDocument();
    expect(seen.breakdowns.map((q) => q.dimension).sort()).toEqual(['client_lang', 'client_tz']);
    expect(await screen.findByText('Page views · top 10')).toBeInTheDocument();
  });

  it('keeps the tab in the URL', async () => {
    mockReads();
    const urls: string[] = [];
    renderWithProviders(<DevicesView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await userEvent.setup().click(screen.getByRole('tab', { name: /Places/ }));
    expect(urls.at(-1)).toContain('tab=places');
    expect(await screen.findByRole('region', { name: 'Time zone' })).toBeInTheDocument();
  });

  it('says honestly why no place is known: every request comes from the gateway address', async () => {
    mockReads({ countries: UNLOCATED });
    renderWithProviders(<DevicesView />, { searchParams: '?tab=places' });
    expect(await screen.findByText('We cannot tell where people are yet')).toBeInTheDocument();
    expect(screen.getByText(/reached Nexus from the gateway's internal address/)).toHaveTextContent(
      '1,500 requests',
    );
    expect(screen.getByText(/Meanwhile, the time zone above/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Data health/ })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Countries' })).toBeNull();
    // The browser's own time zone still shows.
    expect(
      await screen.findByRole('table', { name: 'Time zone: share of page views' }),
    ).toBeInTheDocument();
  });

  it('"Show all values" opens a plain table of every value, fetched only when opened', async () => {
    const seen = mockReads();
    renderWithProviders(<DevicesView />);
    const browser = await screen.findByRole('region', { name: 'Browser' });
    await within(browser).findByRole('table', { name: 'Browser: share of page views' });
    expect(seen.breakdowns.some((q) => q.limit === String(BREAKDOWN_LIMIT_MAX))).toBe(false);

    await userEvent
      .setup()
      .click(within(browser).getByRole('button', { name: 'Show all values: Browser' }));
    const dialog = await screen.findByRole('dialog', { name: 'Browser: all values' });
    const table = await within(dialog).findByRole('table', { name: 'Browser: all values' });
    expect(within(table).getByRole('cell', { name: 'Safari' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '25% of page views' })).toBeInTheDocument();
    expect(
      seen.breakdowns.some(
        (q) => q.dimension === 'browser' && q.limit === String(BREAKDOWN_LIMIT_MAX),
      ),
    ).toBe(true);
  });
});
