import { ERROR_CODES, ROUTES, type OnlineNowDto, type OnlineUserDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { APPS, SESSION_ID, USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { initialsOf, OnlineNowPanel, totalsOf } from './OnlineNowPanel';

const ENDPOINT_ID = '9b2f6a10-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const OTHER_KEY = 'b'.repeat(64);

function onlineUser(overrides: Partial<OnlineUserDto> = {}): OnlineUserDto {
  return {
    userKey: USER_KEY,
    email: 'buyer@libas.in',
    app: 'ebo-sales',
    sessionId: SESSION_ID,
    currentPage: '/orders/:id',
    lastEvent: {
      kind: 'tool_use',
      path: '/orders/:id',
      tool: 'export-csv',
      method: null,
      status: null,
      endpointId: null,
    },
    lastSeenAt: new Date(Date.now() - 30_000).toISOString(),
    events: 12,
    ...overrides,
  };
}

const ONLINE: OnlineNowDto = {
  asOf: new Date().toISOString(),
  windowMs: 300_000,
  apps: [
    { app: 'ebo-sales', users: 4, anonymous: 2 },
    { app: 'hr-portal', users: 1, anonymous: 0 },
  ],
  users: [
    onlineUser(),
    onlineUser({
      userKey: OTHER_KEY,
      email: 'amit.panchal@libas.in',
      app: 'hr-portal',
      sessionId: null,
      currentPage: null,
      lastEvent: {
        kind: 'api',
        path: '/api/leaves/:id',
        tool: null,
        method: 'POST',
        status: 201,
        endpointId: ENDPOINT_ID,
      },
      events: 1,
    }),
  ],
};

const EMPTY: OnlineNowDto = { ...ONLINE, apps: [], users: [] };

/** Answers ROUTES.live.online; records each request's query string. */
function useOnline(body: OnlineNowDto | ((url: URL) => OnlineNowDto), seen: string[] = []) {
  server.use(
    http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
    http.get(routeUrl(ROUTES.live.online), ({ request }) => {
      const url = new URL(request.url);
      seen.push(url.search);
      return HttpResponse.json(typeof body === 'function' ? body(url) : body);
    }),
  );
  return seen;
}

const people = () => screen.findByRole('list', { name: 'People online now' });

describe('OnlineNowPanel', () => {
  it('lists each person: user, app, page, last action, when, events and the session link', async () => {
    useOnline(ONLINE);
    renderWithProviders(<OnlineNowPanel />);

    const list = await people();
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByRole('link', { name: 'buyer@libas.in' }).getAttribute('href')).toBe(
      `/users/${USER_KEY}`,
    );
    expect(first.getByRole('link', { name: 'ebo-sales' }).getAttribute('href')).toBe(
      '/applications/ebo-sales',
    );
    expect(first.getAllByText('/orders/:id').length).toBeGreaterThan(0);
    expect(first.getByText('Tool')).toBeInTheDocument();
    expect(first.getByText('export-csv')).toBeInTheDocument();
    expect(first.getByText('30 s ago')).toBeInTheDocument();
    expect(first.getByText('12 events')).toBeInTheDocument();
    expect(first.getByRole('link', { name: /Open session/ }).getAttribute('href')).toBe(
      `/journeys/ebo-sales/${SESSION_ID}`,
    );

    // An API call links to its route by the opaque endpointId; no session → no session link.
    const second = within(rows[1]!);
    expect(second.getByText('/api/leaves/:id')).toBeInTheDocument();
    expect(second.getByRole('link', { name: /Route/ }).getAttribute('href')).toBe(
      `/endpoints/${ENDPOINT_ID}`,
    );
    expect(second.getByText('1 event')).toBeInTheDocument();
    expect(second.queryByRole('link', { name: /Open session/ })).not.toBeInTheDocument();
  });

  it('announces only the total in a polite live region', async () => {
    useOnline(ONLINE);
    renderWithProviders(<OnlineNowPanel />);
    await people();
    const count = screen.getAllByRole('status').find((el) => el.textContent?.includes('online'));
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(count).toHaveTextContent('7 online');
    expect(count).toHaveTextContent('5 signed in · 2 anonymous');
    // Rows are NOT inside the live region.
    expect(within(count!).queryByText('buyer@libas.in')).not.toBeInTheDocument();
  });

  it('shows one chip per app; a click sets the global app filter, a second click clears it', async () => {
    useOnline(ONLINE);
    const urls: string[] = [];
    const user = userEvent.setup();
    renderWithProviders(<OnlineNowPanel />, {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });

    const chips = await screen.findByRole('group', { name: 'Show one app' });
    const ebo = within(chips).getByRole('button', { name: /EBO Sales · 4 users · 2 anonymous/ });
    expect(ebo).toHaveAttribute('aria-pressed', 'false');
    expect(within(chips).getByRole('button', { name: /hr-portal · 1 user$/ })).toBeInTheDocument();

    await user.click(ebo);
    expect(urls.at(-1)).toBe('?app=ebo-sales');
    await vi.waitFor(() => expect(ebo).toHaveAttribute('aria-pressed', 'true'));

    await user.click(ebo);
    expect(urls.at(-1)).toBe('');
  });

  it('respects the global app filter: chips stay complete, the people are scoped', async () => {
    const seen = useOnline((url) =>
      url.searchParams.get('app') === 'hr-portal'
        ? { ...ONLINE, apps: [ONLINE.apps[1]!], users: [ONLINE.users[1]!] }
        : ONLINE,
    );
    renderWithProviders(<OnlineNowPanel />, { searchParams: '?app=hr-portal&range=7d' });

    const list = await people();
    await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(within(list).getByText('amit.panchal@libas.in')).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Show one app' });
    expect(within(chips).getAllByRole('button')).toHaveLength(2);
    expect(within(chips).getByRole('button', { name: /hr-portal/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The range never travels: online is always "now".
    expect(seen.sort()).toEqual(['', '?app=hr-portal']);
  });

  it('says when it was updated, but not while showing the previous app as a placeholder', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
      http.get(routeUrl(ROUTES.live.online), async ({ request }) => {
        if (new URL(request.url).searchParams.get('app')) await held;
        return HttpResponse.json(ONLINE);
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<OnlineNowPanel />);
    await people();
    expect(screen.getByText(/· updated/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /hr-portal/ }));
    // The ebo rows stay (keepPreviousData) but have no fetch time: no "20000 d ago".
    await vi.waitFor(() => expect(screen.queryByText(/· updated/)).toBeNull());
    expect(screen.queryByText(/d ago/)).toBeNull();
    expect(
      screen.getByRole('list', { name: 'People online now' }).closest('[aria-busy]'),
    ).toHaveAttribute('aria-busy', 'true');

    release();
    await vi.waitFor(() => expect(screen.getByText(/· updated/)).toBeInTheDocument());
  });

  it('says nobody is active, and that the list covers the last 5 minutes', async () => {
    useOnline(EMPTY);
    renderWithProviders(<OnlineNowPanel />);
    expect(await screen.findByText('Nobody is active right now')).toBeInTheDocument();
    expect(
      screen.getByText('This list covers the last 5 minutes and refreshes every 15 s.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show one app' })).not.toBeInTheDocument();
  });

  it('does not say "nobody" when only anonymous sessions are active', async () => {
    useOnline({ ...EMPTY, apps: [{ app: 'ebo-sales', users: 0, anonymous: 3 }] });
    renderWithProviders(<OnlineNowPanel />);
    expect(await screen.findByText('No signed-in people right now')).toBeInTheDocument();
    expect(screen.getByText(/3 anonymous browser sessions are active/)).toBeInTheDocument();
  });

  it('shows an error with a retry when the API fails', async () => {
    server.use(
      http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
      http.get(routeUrl(ROUTES.live.online), () =>
        HttpResponse.json(
          { error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'boom', requestId: 'req-9' } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<OnlineNowPanel />);
    expect(await screen.findByText('Could not load who is online')).toBeInTheDocument();
  });
});

describe('OnlineNowPanel helpers', () => {
  it('initialsOf: two parts → their initials, one part → its first two letters', () => {
    expect(initialsOf('amit.panchal@libas.in')).toBe('AP');
    expect(initialsOf('buyer@libas.in')).toBe('BU');
    expect(initialsOf('x@libas.in')).toBe('X');
  });

  it('totalsOf sums verified and anonymous people over apps', () => {
    expect(totalsOf(ONLINE.apps)).toEqual({ users: 5, anonymous: 2 });
    expect(totalsOf([])).toEqual({ users: 0, anonymous: 0 });
  });
});
