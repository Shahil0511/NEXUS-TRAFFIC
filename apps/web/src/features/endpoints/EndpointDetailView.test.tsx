import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { REQUESTS_ADMINS_ONLY, WHO_ADMINS_ONLY } from '@/components/AdminsOnlyNote';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { PAGES } from '@/lib/pages';
import { ENDPOINT_DETAIL, ME, USER_KEY } from '@/test/fixtures';
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

/** The h2 panel titles in page order (the report sheet's sections). */
function panelTitles(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');
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
      ['Apps', '/applications?range=7d'],
      ['ebo-sales', '/applications/ebo-sales?range=7d'],
      ['Request types', '/endpoints?app=ebo-sales&range=7d'],
    ]);
    expect(within(trail).getByText('GET /api/orders/:id')).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('link', { name: /view failures/i })).toHaveAttribute(
      'href',
      `${PAGES.errors()}?app=ebo-sales&range=7d&endpointId=${ENDPOINT_ID}`,
    );
    const callers = screen.getByRole('list', { name: 'Who calls this request type' });
    expect(await within(callers).findByRole('link', { name: 'buyer@libas.in' })).toHaveAttribute(
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

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Request type' }),
    ).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getAllByRole('link')).toHaveLength(1);
    expect(within(trail).getByRole('link', { name: 'Request types' })).toHaveAttribute(
      'href',
      '/endpoints?app=other',
    );
  });

  it('shows a viewer the count and the notes: no callers, no single requests (ADR 0019)', async () => {
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json({ ...ME, isAdmin: false })),
      http.get(routeUrl(ROUTES.endpoints.detail), () =>
        HttpResponse.json({ ...ENDPOINT_DETAIL, topUsers: null, slowest: null }),
      ),
    );
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: '/api/orders/:id' }),
    ).toBeInTheDocument();
    const callers = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(within(callers).getByText('3 verified people')).toBeInTheDocument();
    expect(within(callers).getByText(WHO_ADMINS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Who calls this request type' })).toBeNull();
    const slowest = screen
      .getByRole('heading', { level: 2, name: 'Slowest calls' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(within(slowest).getByText(REQUESTS_ADMINS_ONLY)).toBeInTheDocument();
    expect(within(slowest).queryByRole('table')).toBeNull();
    expect(document.body.textContent).not.toContain('@libas.in');
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows an admin the callers, most calls first, and the slowest calls table', async () => {
    recordDetailCalls();
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />);
    const callers = await screen.findByRole('list', { name: 'Who calls this request type' });
    expect(
      await within(callers).findByRole('link', { name: 'buyer@libas.in' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Most calls first')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Slowest calls' })).toBeInTheDocument();
    expect(screen.queryByText(REQUESTS_ADMINS_ONLY)).toBeNull();
    expect(screen.queryByText(WHO_ADMINS_ONLY)).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('reads as a report sheet: sentence, facts, chart, around | who, speed and failures, then the slowest calls', async () => {
    recordDetailCalls();
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/api/orders/:id' });

    const sentence = screen.getByText(/^Called/).closest('p')!;
    expect(sentence).toHaveTextContent(
      'Called 1,200 times by 3 verified people in this range. 1.3% failed (12 refused, 4xx · 3 server errors, 5xx). Half the calls answer within 80 ms; 95 in 100 within 420 ms.',
    );

    const facts = screen.getByLabelText('Request type facts');
    const labels = ['API calls', 'Error rate', 'People', 'p50', 'p95', 'p99'];
    expect(
      within(facts)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(labels);
    for (const label of labels) {
      expect(within(facts).getByRole('button', { name: `What is ${label}?` })).toBeInTheDocument();
    }
    expect(within(facts).getByText('12 4xx · 3 5xx')).toBeInTheDocument();
    expect(within(facts).getByText('verified callers')).toBeInTheDocument();
    expect(within(facts).getByText('avg 120 ms')).toBeInTheDocument();
    expect(within(facts).getByText('980 ms')).toBeInTheDocument();

    expect(panelTitles()).toEqual([
      'API calls over time',
      'What happens around it',
      'Who uses it',
      'Speed and failures',
      'Slowest calls',
    ]);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Status codes', 'Latency', 'Errors']);
    expect(screen.getByRole('list', { name: 'Legend' })).toBeInTheDocument();
    // No KPI card row any more.
    expect(screen.queryByRole('region', { name: 'Request type metrics' })).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('reads "not captured" for missing percentiles, drops the avg note and the speed part', async () => {
    server.use(
      http.get(routeUrl(ROUTES.endpoints.detail), () =>
        HttpResponse.json({
          ...ENDPOINT_DETAIL,
          endpoint: {
            ...ENDPOINT_DETAIL.endpoint,
            p50Ms: null,
            p95Ms: null,
            p99Ms: null,
            avgMs: null,
          },
        }),
      ),
    );
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/api/orders/:id' });

    const facts = screen.getByLabelText('Request type facts');
    expect(within(facts).getAllByText('not captured')).toHaveLength(3);
    expect(within(facts).queryByText(/^avg/)).toBeNull();
    const sentence = screen.getByText(/^Called/).closest('p')!;
    expect(sentence).toHaveTextContent(
      'Called 1,200 times by 3 verified people in this range. 1.3% failed (12 refused, 4xx · 3 server errors, 5xx).',
    );
    expect(sentence.textContent).not.toContain('Half the calls');
  });

  it('says nothing failed, shows no failures link and no errors chart when every call succeeded', async () => {
    server.use(
      http.get(routeUrl(ROUTES.endpoints.detail), () =>
        HttpResponse.json({
          ...ENDPOINT_DETAIL,
          endpoint: { ...ENDPOINT_DETAIL.endpoint, errors4xx: 0, errors5xx: 0, errorRate: 0 },
          statusBreakdown: [],
        }),
      ),
    );
    renderWithProviders(<EndpointDetailView endpointId={ENDPOINT_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/api/orders/:id' });

    expect(screen.getByText(/^Called/).closest('p')).toHaveTextContent(
      'Called 1,200 times by 3 verified people in this range. Nothing failed. Half the calls answer within 80 ms; 95 in 100 within 420 ms.',
    );
    expect(screen.queryByRole('link', { name: /view failures/i })).toBeNull();
    expect(screen.getByText('No failures')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.getByText('No responses')).toBeInTheDocument();
  });
});
