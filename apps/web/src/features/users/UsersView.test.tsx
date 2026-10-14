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
    const link = await screen.findByRole('link', { name: 'buyer@libas.in' });
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

  it('searches by email in a POST body — never in a URL — and explains an empty result', async () => {
    const calls = useUserHandlers();
    const bodies: unknown[] = [];
    server.use(
      http.post(routeUrl(ROUTES.users.search), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<UsersView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await screen.findByText('buyer@libas.in');

    await user.type(screen.getByRole('searchbox', { name: 'Search users' }), 'nobody');
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ search: 'nobody' }));
    expect(await screen.findByText('No user matches your search')).toBeInTheDocument();
    expect(calls.every((params) => !params.has('search'))).toBe(true);
    expect(urls.every((query) => !query.includes('nobody'))).toBe(true);
  });

  it('shows the apps each user uses, each opening that app', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const chip = await screen.findByRole('link', { name: 'ebo-sales' });
    expect(chip.getAttribute('href')).toBe('/applications/ebo-sales');
  });

  it('sorts on the server by a clicked column, keeping the choice in the URL', async () => {
    const calls = useUserHandlers();
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<UsersView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await screen.findByText('buyer@libas.in');

    await user.click(screen.getByRole('button', { name: /API calls/ }));
    await waitFor(() => expect(calls.at(-1)?.get('sort')).toBe('requests'));
    expect(calls.at(-1)?.get('dir')).toBe('desc');
    expect(urls.at(-1)).toContain('sort=requests');
  });

  it("links failed requests to the user's failures on Errors (opaque key)", async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const failed = await screen.findByRole('link', {
      name: /12 failed requests of buyer@libas\.in/,
    });
    expect(failed.getAttribute('href')).toBe(`/errors?userKey=${USER_KEY}`);
  });
});
