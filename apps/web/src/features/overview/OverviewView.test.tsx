import { ERROR_CODES, ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { APP_TRAFFIC, ERROR_SUMMARY, OVERVIEW_SUMMARY, OVERVIEW_TIMESERIES } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { OverviewView } from './OverviewView';

function useOverviewHandlers(summaryResolver?: Parameters<typeof http.get>[1]) {
  server.use(
    http.get(
      routeUrl(ROUTES.overview.summary),
      summaryResolver ?? (() => HttpResponse.json(OVERVIEW_SUMMARY)),
    ),
    http.get(routeUrl(ROUTES.overview.timeseries), () => HttpResponse.json(OVERVIEW_TIMESERIES)),
    http.get(routeUrl(ROUTES.errors.summary), () => HttpResponse.json(ERROR_SUMMARY)),
    http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)),
  );
}

describe('OverviewView', () => {
  it('renders the KPI cards from the API (values, deltas coloured by meaning)', async () => {
    useOverviewHandlers();
    renderWithProviders(<OverviewView />);

    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    const requests = await within(metrics).findByRole('heading', { name: 'Requests' });
    const requestsCard = requests.closest('section')!;
    expect(within(requestsCard).getByText('12.3K')).toBeInTheDocument();
    expect(within(requestsCard).getByText('+23.4%')).toBeInTheDocument();

    const errorRateCard = within(metrics)
      .getByRole('heading', { name: 'Error rate' })
      .closest('section')!;
    expect(within(errorRateCard).getByText('2.5%')).toBeInTheDocument();

    expect(within(metrics).getByText('840 ms')).toBeInTheDocument();
    expect(within(metrics).getByText('7')).toBeInTheDocument();
    expect(within(metrics).getByText('no previous data')).toBeInTheDocument();
    // Top failing routes come from errors.summary and link by opaque id only.
    const link = await screen.findByRole('link', { name: /\/api\/orders\/:id/ });
    expect(link.getAttribute('href')).toBe('/endpoints/6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11');
  });

  it('forwards the URL filters to the API', async () => {
    const seen: string[] = [];
    useOverviewHandlers(({ request }) => {
      seen.push(new URL(request.url).search);
      return HttpResponse.json(OVERVIEW_SUMMARY);
    });
    renderWithProviders(<OverviewView />, { searchParams: '?app=ebo-sales&range=7d' });
    await screen.findByText('12.3K');
    expect(seen).toEqual(['?app=ebo-sales&range=7d']);
  });

  it('shows skeletons while loading', async () => {
    useOverviewHandlers(async () => {
      await delay('infinite');
      return HttpResponse.json(OVERVIEW_SUMMARY);
    });
    renderWithProviders(<OverviewView />);
    const metrics = screen.getByRole('region', { name: 'Key metrics' });
    expect(within(metrics).getAllByRole('heading').length).toBe(6);
    expect(metrics.querySelectorAll('[aria-busy="true"]').length).toBe(6);
    expect(within(metrics).queryByText('12.3K')).not.toBeInTheDocument();
  });

  it('shows the API error with its request id and a retry button', async () => {
    useOverviewHandlers(() =>
      HttpResponse.json(
        {
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'database unavailable',
            requestId: 'req-42',
          },
        },
        { status: 500 },
      ),
    );
    renderWithProviders(<OverviewView />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load the headline numbers')).toBeInTheDocument();
    expect(within(alert).getByText('database unavailable')).toBeInTheDocument();
    expect(within(alert).getByText(/Request ID req-42/)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('turns a too-long range into a one-click fix instead of an error', async () => {
    useOverviewHandlers(() =>
      HttpResponse.json(
        { error: { code: ERROR_CODES.RANGE_TOO_LARGE, message: 'too large', requestId: 'r' } },
        { status: 400 },
      ),
    );
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<OverviewView />, {
      searchParams: '?range=90d',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await screen.findByText('This range is too long for this view');
    await user.click(screen.getByRole('button', { name: 'Show the last 30 days' }));
    expect(urls.at(-1)).toContain('range=30d');
  });

  it('links every KPI card to its breakdown, keeping the filters', async () => {
    useOverviewHandlers();
    renderWithProviders(<OverviewView />, { searchParams: '?range=7d' });
    const metrics = await screen.findByRole('region', { name: 'Key metrics' });
    await within(metrics).findByText('12.3K');
    const hrefs = within(metrics)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/endpoints?range=7d',
      '/errors?range=7d',
      '/endpoints?range=7d&sort=p95',
      '/live',
      '/pages?range=7d',
      '/users?range=7d',
    ]);
  });

  it('previews the busiest applications, each opening its own page', async () => {
    useOverviewHandlers();
    renderWithProviders(<OverviewView />, { searchParams: '?range=7d' });
    const apps = await screen.findByRole('list', { name: 'Applications' });
    const link = await within(apps).findByRole('link', { name: 'EBO Sales' });
    expect(link.getAttribute('href')).toBe('/applications/ebo-sales?range=7d');
    expect(within(apps).getByText('38')).toBeInTheDocument();
  });
});
