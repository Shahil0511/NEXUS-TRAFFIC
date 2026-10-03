import { ROUTES } from '@nexus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { USER_KEY, userSummary } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { UsersView } from './UsersView';

const SECOND_KEY = 'b'.repeat(64);
const NEXT_CURSOR = 'cursor-after-first';

/** Two pages: the first carries a nextCursor, the second ends the list. */
function useUserHandlers(): URLSearchParams[] {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.users.list), ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push(params);
      if (params.get('search')) return HttpResponse.json({ items: [], nextCursor: null });
      return params.get('cursor') === NEXT_CURSOR
        ? HttpResponse.json({
            items: [userSummary({ userKey: SECOND_KEY, email: 'planner@libas.in' })],
            nextCursor: null,
          })
        : HttpResponse.json({ items: [userSummary()], nextCursor: NEXT_CURSOR });
    }),
  );
  return calls;
}

describe('UsersView', () => {
  it('lists verified users, each linked to its profile by the opaque userKey', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />, { searchParams: '?range=7d' });
    const link = await screen.findByRole('link', { name: /buyer@libas\.in/ });
    expect(link.getAttribute('href')).toBe(`/users/${USER_KEY}?range=7d`);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText(/Verified identities only/)).toBeInTheDocument();
  });

  it('"Load more" fetches the next page with the cursor and appends it', async () => {
    const calls = useUserHandlers();
    const user = userEvent.setup();
    renderWithProviders(<UsersView />);
    await screen.findByText('buyer@libas.in');

    await user.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('planner@libas.in')).toBeInTheDocument();
    expect(screen.getByText('buyer@libas.in')).toBeInTheDocument();
    expect(calls.at(-1)?.get('cursor')).toBe(NEXT_CURSOR);
  });

  it('searches by email (debounced) and explains an empty result', async () => {
    const calls = useUserHandlers();
    const user = userEvent.setup();
    renderWithProviders(<UsersView />);
    await screen.findByText('buyer@libas.in');

    await user.type(screen.getByRole('searchbox', { name: 'Search users' }), 'nobody');
    await waitFor(() => expect(calls.at(-1)?.get('search')).toBe('nobody'));
    expect(await screen.findByText('No user matches your search')).toBeInTheDocument();
  });
});
