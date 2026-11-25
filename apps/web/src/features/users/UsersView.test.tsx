import { ROUTES } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
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

  it('names its columns like the nav: Person and Visits', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const table = await screen.findByRole('table', { name: 'People' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent ?? '');
    expect(headers[0]).toBe('Person');
    expect(headers.some((text) => text.startsWith('Visits'))).toBe(true);
    expect(headers.some((text) => /user|session/i.test(text))).toBe(false);
  });

  it('uses neutral words only: headers, hints and every label a reader can meet (ADR 0017)', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    await screen.findByRole('table', { name: 'People' });
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
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

    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'nobody');
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ search: 'nobody' }));
    expect(await screen.findByText('No person matches your search')).toBeInTheDocument();
    expect(calls.every((params) => !params.has('search'))).toBe(true);
    expect(urls.every((query) => !query.includes('nobody'))).toBe(true);
  });

  it('shows the apps each user uses, each opening that app', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const chip = await screen.findByRole('link', { name: 'ebo-sales' });
    expect(chip.getAttribute('href')).toBe('/applications/ebo-sales');
  });

  it('sorts on the server by last activity by default, or by first activity, keeping the choice in the URL', async () => {
    const calls = useUserHandlers();
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<UsersView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await screen.findByText('buyer@libas.in');
    expect(calls[0]?.get('sort')).toBe('lastSeen');
    expect(calls[0]?.get('dir')).toBe('desc');

    await user.click(screen.getByRole('button', { name: 'First activity' }));
    await waitFor(() => expect(calls.at(-1)?.get('sort')).toBe('firstSeen'));
    expect(calls.at(-1)?.get('dir')).toBe('desc');
    expect(urls.at(-1)).toContain('sort=firstSeen');
  });

  it('never puts people in an order by an amount: the count columns have no sort control', async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const table = await screen.findByRole('table', { name: 'People' });
    // The (i) buttons of the column hints carry an aria-label ("What is …?"); sort buttons do not.
    const sortButtons = within(table)
      .getAllByRole('button')
      .filter((button) => !button.hasAttribute('aria-label'))
      .map((button) => button.textContent);
    expect(sortButtons).toEqual(['First activity', 'Last activity']);
    for (const name of ['API calls', 'Failed', 'Page views', 'Visits']) {
      expect(within(table).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it.each(['requests', 'pageViews', 'sessions', 'failed'])(
    'an old link sorted by a retired count (?sort=%s) falls back to last activity first',
    async (retired) => {
      const calls = useUserHandlers();
      renderWithProviders(<UsersView />, { searchParams: `?sort=${retired}&dir=asc` });
      expect(await screen.findByText('buyer@libas.in')).toBeInTheDocument();
      expect(calls[0]?.get('sort')).toBe('lastSeen');
      expect(calls[0]?.get('dir')).toBe('asc');
    },
  );

  it("links failed requests to the user's failures on Errors (opaque key)", async () => {
    useUserHandlers();
    renderWithProviders(<UsersView />);
    const failed = await screen.findByRole('link', {
      name: /12 failed requests of buyer@libas\.in/,
    });
    expect(failed.getAttribute('href')).toBe(`/errors?userKey=${USER_KEY}`);
  });

  it('a viewer who is not an admin gets the list as plain text: no link to a page that refuses them', async () => {
    useUserHandlers();
    server.use(
      http.get(routeUrl(ROUTES.me.get), () =>
        HttpResponse.json({ email: 'viewer@libas.in', isAdmin: false }),
      ),
    );
    renderWithProviders(<UsersView />);
    expect(await screen.findByText('buyer@libas.in')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'buyer@libas.in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /failed requests of/ })).not.toBeInTheDocument();
  });
});
