import { ROUTES } from '@nexus/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { CLAIMED_SESSION, SESSION_DETAIL, SESSION_ID, USER_KEY } from '@/test/fixtures';
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

    const replay = await screen.findByRole('list', { name: 'Session replay' });
    expect(seen).toEqual([`ebo-sales/${SESSION_ID}`]);
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
    fireEvent.click(screen.getByRole('button', { name: 'Copy session id' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SESSION_ID));

    const metrics = screen.getByRole('region', { name: 'Session metrics' });
    expect(within(metrics).getByText('12m 0s')).toBeInTheDocument();
    expect(within(metrics).getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /user profile/i }).getAttribute('href')).toBe(
      `/users/${USER_KEY}?app=ebo-sales`,
    );
  });

  it("scopes the trail and every link to the session's app, even under another app's filter", async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () => HttpResponse.json(SESSION_DETAIL)),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />, {
      searchParams: '?app=other&range=7d',
    });

    const replay = await screen.findByRole('list', { name: 'Session replay' });
    // Applications › ebo-sales › Journeys › Session xxxxxxxx
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(trail).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Applications', '/applications?range=7d'],
      ['ebo-sales', '/applications/ebo-sales?range=7d'],
      ['Journeys', '/journeys?app=ebo-sales&range=7d'],
    ]);
    expect(screen.getByRole('link', { name: /user profile/i })).toHaveAttribute(
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
    expect(screen.queryByRole('link', { name: /user profile/i })).not.toBeInTheDocument();
  });
});
