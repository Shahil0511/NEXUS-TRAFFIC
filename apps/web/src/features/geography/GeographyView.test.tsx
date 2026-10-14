import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { guideHref } from '@/lib/guide';
import { GEO_CITIES, GEO_COUNTRIES, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { countryBars, GeographyView, isAllUnlocated, metricWithData } from './GeographyView';

/** An API-only app: located traffic, but no page views anywhere. */
const API_ONLY = {
  window: WINDOW,
  items: [
    { country: 'IN', requests: 900, pageViews: 0, users: 4 },
    { country: null, requests: 100, pageViews: 0, users: 0 },
  ],
};

/** Deployed reality on an internal network: traffic exists, none of it has a location. */
const UNLOCATED = {
  window: WINDOW,
  items: [{ country: null, requests: 1_500, pageViews: 120, users: 6 }],
};

describe('GeographyView', () => {
  it('renders countries (unknown labelled), approximate cities and the GeoLite2 attribution', async () => {
    const seen: string[] = [];
    server.use(
      http.get(routeUrl(ROUTES.geo.countries), ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json(GEO_COUNTRIES);
      }),
      http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json(GEO_CITIES)),
    );
    renderWithProviders(<GeographyView />, { searchParams: '?app=ebo-sales' });

    const countries = await screen.findByRole('table', { name: 'Countries' });
    expect(await within(countries).findByText('India')).toBeInTheDocument();
    expect(within(countries).getByText('9,800')).toBeInTheDocument();
    expect(within(countries).getByText('Unknown')).toBeInTheDocument();
    expect(seen[0]).toContain('app=ebo-sales');

    const cities = screen.getByRole('table', { name: 'Cities (approximate)' });
    expect(await within(cities).findByText('Mumbai')).toBeInTheDocument();
    expect(screen.getByText('approximate')).toBeInTheDocument();
    expect(screen.getByText(/GeoLite2 data created by MaxMind/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://www.maxmind.com' })).toBeInTheDocument();
  });

  it('explains (instead of empty charts) when no traffic could be located, linking the guide', async () => {
    server.use(
      http.get(routeUrl(ROUTES.geo.countries), () => HttpResponse.json(UNLOCATED)),
      http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json({ window: WINDOW, items: [] })),
    );
    renderWithProviders(<GeographyView />, { searchParams: '?range=7d' });

    expect(await screen.findByText('None of this traffic could be located')).toBeInTheDocument();
    // Plain words first (for managers), the technical cause second.
    const description = screen.getByText(/came from inside the company network/);
    expect(description).toHaveTextContent('1,500 requests');
    expect(description.textContent?.indexOf('company network')).toBeLessThan(
      description.textContent?.indexOf('X-Forwarded-For') ?? -1,
    );
    expect(screen.getByRole('link', { name: /forward the client IP/ })).toHaveAttribute(
      'href',
      guideHref('clientIp'),
    );
    expect(screen.queryByRole('table', { name: 'Countries' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rank countries by' })).toBeNull();
  });

  it('offers a wider range (not "no located traffic") when the window has no traffic at all', async () => {
    server.use(
      http.get(routeUrl(ROUTES.geo.countries), () =>
        HttpResponse.json({ window: WINDOW, items: [] }),
      ),
      http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json({ window: WINDOW, items: [] })),
    );
    renderWithProviders(<GeographyView />);
    expect(await screen.findAllByText('No traffic in this window')).toHaveLength(2);
    expect(
      screen.getAllByText('Nothing was recorded for the selected app and range.'),
    ).toHaveLength(2);
    expect(screen.queryByText('No located traffic')).toBeNull();
    expect(screen.queryByText('None of this traffic could be located')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Show the last 7 days' }).length).toBeGreaterThan(
      0,
    );
  });

  it('names the empty metric (not "public IP") and offers Requests when page views are 0', async () => {
    const urls: string[] = [];
    server.use(
      http.get(routeUrl(ROUTES.geo.countries), () => HttpResponse.json(API_ONLY)),
      http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json({ window: WINDOW, items: [] })),
    );
    renderWithProviders(<GeographyView />, {
      searchParams: '?metric=pageViews',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(await screen.findByText('No page views in this window')).toBeInTheDocument();
    expect(screen.queryByText(/public IP/)).toBeNull();
    expect(screen.queryByText('None of this traffic could be located')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show requests' }));
    // Requests is the default, so the param is cleared from the URL.
    expect(urls.at(-1)).not.toContain('metric=');
    expect(await screen.findByText('Requests · top 10')).toBeInTheDocument();
  });

  it('picks the first other metric with data to switch to', () => {
    expect(metricWithData(API_ONLY.items, 'pageViews')).toBe('requests');
    expect(metricWithData(API_ONLY.items, 'requests')).toBe('users');
    expect(
      metricWithData([{ country: 'IN', requests: 0, pageViews: 5, users: 0 }], 'requests'),
    ).toBe('pageViews');
    expect(
      metricWithData([{ country: 'IN', requests: 3, pageViews: 0, users: 0 }], 'requests'),
    ).toBeNull();
  });

  it('keeps the chart metric in the URL (?metric=)', async () => {
    const urls: string[] = [];
    server.use(
      http.get(routeUrl(ROUTES.geo.countries), () => HttpResponse.json(GEO_COUNTRIES)),
      http.get(routeUrl(ROUTES.geo.cities), () => HttpResponse.json(GEO_CITIES)),
    );
    renderWithProviders(<GeographyView />, {
      searchParams: '?metric=users',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(await screen.findByText('Users · top 10')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Rank by page views' }));
    expect(urls.at(-1)).toContain('metric=pageViews');
    expect(await screen.findByText('Page views · top 10')).toBeInTheDocument();
  });

  it('flags "all unlocated" only when there is traffic and every country is unknown', () => {
    expect(isAllUnlocated(UNLOCATED.items)).toBe(true);
    expect(isAllUnlocated(GEO_COUNTRIES.items)).toBe(false);
    expect(isAllUnlocated([])).toBe(false);
    expect(isAllUnlocated(undefined)).toBe(false);
  });

  it('ranks the chart by the chosen metric and drops zero rows', () => {
    expect(countryBars(GEO_COUNTRIES.items, 'requests').map((bar) => bar.label)).toEqual([
      'India',
      'United Arab Emirates',
      'Unknown',
    ]);
    expect(countryBars(GEO_COUNTRIES.items, 'pageViews').map((bar) => bar.label)).toEqual([
      'India',
      'Unknown',
    ]);
    expect(countryBars(GEO_COUNTRIES.items, 'users').map((bar) => bar.key)).toEqual(['IN', 'AE']);
  });
});
