import { ERROR_CODES, ROUTES } from '@nexus/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { CLAIMED_SESSION, SESSION_DETAIL, SESSION_ID, USER_KEY } from '@/test/fixtures';
import { METRIC_COPY } from '@/lib/metricCopy';
import { PAGES } from '@/lib/pages';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { SessionDetailView } from './SessionDetailView';

/** The opaque endpointId the fixture's API call ("e3") carries. */
const API_ENDPOINT_ID = SESSION_DETAIL.events.find((event) => event.kind === 'api')!.endpointId!;

describe('SessionDetailView', () => {
  it('replays the session: pages in order with visible time, tools and API calls nested', async () => {
    const seen: string[] = [];
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), ({ params }) => {
        seen.push(`${String(params.app)}/${String(params.sessionId)}`);
        return HttpResponse.json(SESSION_DETAIL);
      }),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />);

    const replay = await screen.findByRole('list', { name: 'Visit steps' });
    expect(seen).toEqual([`ebo-sales/${SESSION_ID}`]);
    // The steps are headed "Visit steps" (never "Replay": nothing on screen was recorded as video).
    expect(screen.getByRole('heading', { name: 'Visit steps' })).toBeInTheDocument();
    expect(screen.queryByText('Replay')).toBeNull();
    const steps = within(replay).getAllByText(/^Page \d$/);
    expect(steps.map((step) => step.textContent)).toEqual(['Page 1', 'Page 2']);
    expect(within(replay).getByText('42.00 s visible')).toBeInTheDocument();
    expect(within(replay).getByText('2m 5s visible')).toBeInTheDocument();
    expect(within(replay).getByText('export-csv')).toBeInTheDocument();
    expect(within(replay).getByText('/api/orders/export')).toBeInTheDocument();
    expect(within(replay).getByText('500')).toBeInTheDocument();
    expect(within(replay).getByText('+0:42')).toBeInTheDocument();
    // The API call keeps its route link (opaque endpointId) and the long path its tooltip.
    expect(within(replay).getByText('/api/orders/export')).toHaveAttribute(
      'title',
      '/api/orders/export',
    );
    const routeLinks = within(replay).getAllByRole('link', { name: /Route/ });
    expect(routeLinks.length).toBeGreaterThan(0);
    for (const link of routeLinks) {
      expect(link.getAttribute('href')).toMatch(
        new RegExp(`^${PAGES.endpointDetail(API_ENDPOINT_ID)}(\\?|$)`),
      );
    }

    // The full session id is one click away (the title shows only a prefix).
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy visit id' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SESSION_ID));

    const metrics = screen.getByRole('region', { name: 'Visit metrics' });
    expect(within(metrics).getByText('12m 0s')).toBeInTheDocument();
    expect(within(metrics).getByText('1 failed')).toBeInTheDocument();
    expect((await screen.findByRole('link', { name: /person page/i })).getAttribute('href')).toBe(
      `/users/${USER_KEY}?app=ebo-sales`,
    );
  });

  it('explains the Visible time card, including the 1-minute credit per delta (ADR 0017)', async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () => HttpResponse.json(SESSION_DETAIL)),
    );
    const user = userEvent.setup();
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />);
    await screen.findByRole('list', { name: 'Visit steps' });
    const metrics = screen.getByRole('region', { name: 'Visit metrics' });
    await user.click(within(metrics).getByRole('button', { name: 'What is Visible time?' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(METRIC_COPY.visibleTime.short);
    expect(tip).toHaveTextContent('counts at most 1 minute');
  });

  it("scopes the trail and every link to the session's app, even under another app's filter", async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () => HttpResponse.json(SESSION_DETAIL)),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />, {
      searchParams: '?app=other&range=7d',
    });

    const replay = await screen.findByRole('list', { name: 'Visit steps' });
    // Apps › ebo-sales › Visits › Visit xxxxxxxx
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(trail).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Apps', '/applications?range=7d'],
      ['ebo-sales', '/applications/ebo-sales?range=7d'],
      ['Visits', '/journeys?app=ebo-sales&range=7d'],
    ]);
    expect(await screen.findByRole('link', { name: /person page/i })).toHaveAttribute(
      'href',
      `/users/${USER_KEY}?app=ebo-sales&range=7d`,
    );
    for (const link of within(replay).getAllByRole('link', { name: /Route/ })) {
      expect(link).toHaveAttribute(
        'href',
        `${PAGES.endpointDetail(API_ENDPOINT_ID)}?app=ebo-sales&range=7d`,
      );
    }
  });

  it("a 403 (a verified person's visit, not an admin) shows the admins-only state, not an error", async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () =>
        HttpResponse.json(
          {
            error: {
              code: ERROR_CODES.FORBIDDEN,
              message: 'Only admins can open the steps',
              requestId: 'r',
            },
          },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />, {
      searchParams: '?range=7d',
    });
    expect(
      await screen.findByRole('heading', { name: 'Only admins can open this visit' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      `Visit ${SESSION_ID.slice(0, 8)}`,
    );
    // The visit trail stays; the way out is the People list (open to every viewer).
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Visits' })).toHaveAttribute(
      'href',
      '/journeys?app=ebo-sales&range=7d',
    );
    expect(screen.getByRole('link', { name: 'Back to People' })).toHaveAttribute(
      'href',
      '/users?range=7d',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Only admins can open the steps')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Visit steps' })).toBeNull();
  });

  it('a 404 still shows the error state (only a 403 means admins only)', async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () =>
        HttpResponse.json(
          { error: { code: ERROR_CODES.NOT_FOUND, message: 'No events', requestId: 'r' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />);
    expect(await screen.findByText('No events')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Only admins can open this visit' })).toBeNull();
  });

  it('flags a claimed identity and offers no profile link', async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () =>
        HttpResponse.json({ ...SESSION_DETAIL, summary: CLAIMED_SESSION }),
      ),
    );
    renderWithProviders(
      <SessionDetailView app="ebo-sales" sessionId={CLAIMED_SESSION.sessionId} />,
    );
    expect(await screen.findByText('someone@libas.in')).toBeInTheDocument();
    expect(screen.getByLabelText('claimed identity, not verified')).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.9/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /person page/i })).not.toBeInTheDocument();
  });
});
