import { ROUTES } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APPS, ENDPOINT_PAGE, USER_KEY, userSummary } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { CommandPalette, matchesQuery } from './CommandPalette';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('matchesQuery', () => {
  it('matches every word, in any order, case-insensitively', () => {
    expect(matchesQuery('API Routes Calls per route', 'routes')).toBe(true);
    expect(matchesQuery('API Routes Calls per route', 'route API')).toBe(true);
    expect(matchesQuery('Users', 'errors')).toBe(false);
    expect(matchesQuery('anything', '')).toBe(true);
  });
});

describe('CommandPalette', () => {
  beforeEach(() => push.mockReset());

  function useHandlers(): unknown[] {
    const searchBodies: unknown[] = [];
    server.use(
      http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
      http.get(routeUrl(ROUTES.endpoints.list), () => HttpResponse.json(ENDPOINT_PAGE)),
      http.post(routeUrl(ROUTES.users.search), async ({ request }) => {
        searchBodies.push(await request.json());
        return HttpResponse.json({ items: [userSummary()], nextCursor: null });
      }),
    );
    return searchBodies;
  }

  it('opens with Ctrl+K and jumps to a page with the keyboard', async () => {
    useHandlers();
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { searchParams: '?range=7d' });

    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search' });
    // "failed" is only in the Errors page's description, so it is the first (active) result.
    await user.type(input, 'failed');
    expect(screen.getByRole('option', { name: /^Errors/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/errors?range=7d');
  });

  it('opens with Cmd+K too, from a search button that announces its shortcuts', async () => {
    useHandlers();
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);

    // Below sm the button shows only an icon, so its name must not depend on the visible text.
    expect(
      screen.getByRole('button', { name: 'Search pages, apps, users, routes…' }),
    ).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K /');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('combobox', { name: 'Search' })).toHaveFocus();
  });

  it('finds users by email through a POST body and opens them by opaque key', async () => {
    const bodies = useHandlers();
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);

    await user.click(screen.getByRole('button', { name: /Search pages, apps, users, routes/ }));
    await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'buyer');
    const listbox = await screen.findByRole('listbox', { name: 'Results' });
    const option = await within(listbox).findByRole('option', { name: /buyer@libas\.in/ });
    expect(bodies.at(-1)).toMatchObject({ search: 'buyer', limit: 5 });

    await user.click(option);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/users/${USER_KEY}`));
  });
});
