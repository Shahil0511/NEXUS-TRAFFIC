import { ROUTES } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { CLAIMED_SESSION, SESSION_ID, sessionSummary, TOP_PATHS, USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { JourneysView } from './JourneysView';

/** Records the query string of every journeys.sessions call. */
function useJourneyHandlers(): URLSearchParams[] {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.journeys.topPaths), () => HttpResponse.json(TOP_PATHS)),
    http.get(routeUrl(ROUTES.journeys.sessions), ({ request }) => {
      calls.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items: [sessionSummary(), CLAIMED_SESSION], nextCursor: null });
    }),
  );
  return calls;
}

describe('JourneysView', () => {
  it('ranks the top 3-step paths', async () => {
    useJourneyHandlers();
    renderWithProviders(<JourneysView />);
    const paths = await screen.findByRole('list', { name: 'Top paths' });
    expect(within(paths).getByText('/orders/:id')).toBeInTheDocument();
    expect(within(paths).getByText('18')).toBeInTheDocument();
    expect(within(paths).getAllByText('then')).toHaveLength(2);
  });

  it('lists sessions linked to their replay; a claimed identity is flagged, IP only when sent', async () => {
    useJourneyHandlers();
    renderWithProviders(<JourneysView />, { searchParams: '?app=ebo-sales' });
    const table = await screen.findByRole('table', { name: 'Sessions' });
    const replay = (await within(table).findAllByRole('link'))[0]!;
    expect(replay.getAttribute('href')).toBe(`/journeys/ebo-sales/${SESSION_ID}?app=ebo-sales`);
    expect(within(table).getAllByText('buyer@libas.in').length).toBeGreaterThan(0);
    expect(within(table).getByText('someone@libas.in')).toBeInTheDocument();
    expect(within(table).getAllByLabelText('claimed identity, not verified')).toHaveLength(1);
    expect(within(table).getByText(/203\.0\.113\.9/)).toBeInTheDocument();
    expect(within(table).getAllByText('12m 0s')).toHaveLength(2);
  });

  it('narrows to one user from ?userKey= and can clear it', async () => {
    const calls = useJourneyHandlers();
    const user = userEvent.setup();
    renderWithProviders(<JourneysView />, { searchParams: `?userKey=${USER_KEY}` });
    await screen.findByRole('table', { name: 'Sessions' });
    expect(calls[0]?.get('userKey')).toBe(USER_KEY);

    // The chip names the user (from the rows, not the URL) and removes the filter.
    await user.click(
      await screen.findByRole('button', { name: 'Remove user filter buyer@libas.in' }),
    );
    await waitFor(() => expect(calls.at(-1)?.get('userKey')).toBeNull());
  });

  it('ignores a malformed ?userKey= instead of sending it', async () => {
    const calls = useJourneyHandlers();
    renderWithProviders(<JourneysView />, { searchParams: '?userKey=not-a-key' });
    await screen.findByRole('table', { name: 'Sessions' });
    expect(calls[0]?.get('userKey')).toBeNull();
  });
});
