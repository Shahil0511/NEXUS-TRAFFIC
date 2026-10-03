import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { GEO_CITIES, GEO_COUNTRIES } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { countryBars, GeographyView } from './GeographyView';

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
