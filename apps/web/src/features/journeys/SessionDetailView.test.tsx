import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { CLAIMED_SESSION, SESSION_DETAIL, SESSION_ID, USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { SessionDetailView } from './SessionDetailView';

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

    const metrics = screen.getByRole('region', { name: 'Session metrics' });
    expect(within(metrics).getByText('12m 0s')).toBeInTheDocument();
    expect(within(metrics).getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /user profile/i }).getAttribute('href')).toBe(
      `/users/${USER_KEY}`,
    );
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
