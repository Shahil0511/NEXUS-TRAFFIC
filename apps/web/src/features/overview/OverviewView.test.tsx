import { ERROR_CODES, ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ERROR_SUMMARY, OVERVIEW_SUMMARY, OVERVIEW_TIMESERIES } from '@/test/fixtures';
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
            code: ERROR_CODES.RANGE_TOO_LARGE,
            message: 'range too large',
            requestId: 'req-42',
          },
        },
        { status: 400 },
      ),
    );
    renderWithProviders(<OverviewView />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load the headline numbers')).toBeInTheDocument();
    expect(within(alert).getByText('range too large')).toBeInTheDocument();
    expect(within(alert).getByText(/Request ID req-42/)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
