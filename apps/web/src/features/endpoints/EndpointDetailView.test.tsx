import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { PAGES } from '@/lib/pages';
import { ENDPOINT_DETAIL, USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { EndpointDetailView } from './EndpointDetailView';

const ENDPOINT_ID = ENDPOINT_DETAIL.endpoint.endpointId;

/** Records the query string of every endpoints.detail call. */
function recordDetailCalls(): URLSearchParams[] {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.endpoints.detail), ({ request }) => {
      calls.push(new URL(request.url).searchParams);
      return HttpResponse.json(ENDPOINT_DETAIL);
    }),
  );
  return calls;
}

describe('EndpointDetailView', () => {
  it("scopes every link to the route's own app, even under another app's filter", async () => {
    const calls = recordDetailCalls();
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />, {
      searchParams: '?app=other&range=7d',
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: '/api/orders/:id' }),
    ).toBeInTheDocument();
    // The opaque id IS the app scope: a stale ?app=other must not 404 the route.
    expect(calls.map((query) => query.get('app'))).toEqual([null]);
    expect(calls[0]?.get('range')).toBe('7d');

    // Applications › ebo-sales › API Routes › GET /api/orders/:id
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(trail).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Applications', '/applications?range=7d'],
      ['ebo-sales', '/applications/ebo-sales?range=7d'],
      ['API Routes', '/endpoints?app=ebo-sales&range=7d'],
    ]);
    expect(within(trail).getByText('GET /api/orders/:id')).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('link', { name: /view failures/i })).toHaveAttribute(
      'href',
      `${PAGES.errors()}?app=ebo-sales&range=7d&endpointId=${ENDPOINT_ID}`,
    );
    const callers = screen.getByRole('list', { name: 'Top callers' });
    expect(within(callers).getByRole('link', { name: 'buyer@libas.in' })).toHaveAttribute(
      'href',
      `/users/${USER_KEY}?app=ebo-sales&range=7d`,
    );
  });

  it('keeps the API Routes crumb on the global filters while the route is unknown', async () => {
    server.use(
      http.get(routeUrl(ROUTES.endpoints.detail), () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'gone' } }, { status: 404 }),
      ),
    );
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />, {
      searchParams: '?app=other',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Route' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getAllByRole('link')).toHaveLength(1);
    expect(within(trail).getByRole('link', { name: 'API Routes' })).toHaveAttribute(
      'href',
      '/endpoints?app=other',
    );
  });
});
