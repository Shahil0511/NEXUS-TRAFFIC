import { ROUTES } from '@nexus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { METRIC_COPY } from '@/lib/metricCopy';
import { ENDPOINT_PAGE } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { EndpointsView } from './EndpointsView';

/** Records the query string of every endpoints.list call. */
function recordListCalls(): URLSearchParams[] {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.endpoints.list), ({ request }) => {
      calls.push(new URL(request.url).searchParams);
      return HttpResponse.json(ENDPOINT_PAGE);
    }),
  );
  return calls;
}

describe('EndpointsView', () => {
  it('renders one row per route, linked by opaque endpointId', async () => {
    recordListCalls();
    renderWithProviders(<EndpointsView />);
    const link = await screen.findByRole('link', { name: /\/api\/orders\/:id/ });
    expect(link.getAttribute('href')).toBe('/endpoints/6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11');
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /calls/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sorts server-side: a header click sends the whitelisted sort key', async () => {
    const calls = recordListCalls();
    const user = userEvent.setup();
    renderWithProviders(<EndpointsView />);
    await screen.findByRole('link', { name: /\/api\/orders\/:id/ });
    expect(calls[0]?.get('sort')).toBe('calls');
    expect(calls[0]?.get('dir')).toBe('desc');

    await user.click(screen.getByRole('button', { name: 'p95' }));
    await waitFor(() => expect(calls.at(-1)?.get('sort')).toBe('p95'));
    expect(calls.at(-1)?.get('dir')).toBe('desc');
    expect(screen.getByRole('columnheader', { name: /p95/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(screen.getByRole('button', { name: 'p95' }));
    await waitFor(() => expect(calls.at(-1)?.get('dir')).toBe('asc'));
  });

  it('shows an empty state when the window has no routes', async () => {
    server.use(
      http.get(routeUrl(ROUTES.endpoints.list), () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<EndpointsView />);
    expect(await screen.findByText('No API traffic in this window')).toBeInTheDocument();
  });

  it('explains the metric columns and names the 4xx / 5xx counts', async () => {
    recordListCalls();
    const user = userEvent.setup();
    renderWithProviders(<EndpointsView />);
    const row = (await screen.findByRole('link', { name: /\/api\/orders\/:id/ })).closest('tr')!;
    expect(row).toHaveTextContent(/12\s*4xx\s*·\s*3\s*5xx/);

    for (const header of ['Errors', 'p50', 'p95', 'p99']) {
      expect(screen.getByRole('button', { name: `What is ${header}?` })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'What is p95?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(METRIC_COPY.p95.short);
  });
});
