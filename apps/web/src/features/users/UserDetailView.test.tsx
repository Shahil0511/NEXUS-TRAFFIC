import { ERROR_CODES, ROUTES, type OnlineNowDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/apiError';
import { APPS, SESSION_ID, timelineItem, USER_KEY, USER_PROFILE } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { isNoActivity, UserDetailView } from './UserDetailView';

const NOBODY_ONLINE: OnlineNowDto = {
  asOf: '2026-10-01T08:00:00.000Z',
  windowMs: 300_000,
  apps: [],
  users: [],
};

function useProfileHandlers(profileStatus = 200, online: OnlineNowDto = NOBODY_ONLINE): void {
  server.use(
    http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
    http.get(routeUrl(ROUTES.live.online), () => HttpResponse.json(online)),
    http.get(routeUrl(ROUTES.users.profile), () =>
      profileStatus === 200
        ? HttpResponse.json(USER_PROFILE)
        : HttpResponse.json(
            {
              error: {
                code: ERROR_CODES.NOT_FOUND,
                message: 'no activity for this user',
                requestId: 'req-7',
              },
            },
            { status: profileStatus },
          ),
    ),
    http.get(routeUrl(ROUTES.users.timeline), () =>
      HttpResponse.json({
        items: [
          timelineItem('t-api', 'api', { path: '/api/orders/123', ip: '203.0.113.7' }),
          timelineItem('t-page', 'page_view'),
          timelineItem('t-tool', 'tool_use', { sessionId: null }),
        ],
        nextCursor: null,
      }),
    ),
  );
}

describe('UserDetailView', () => {
  it('renders the profile: totals, top pages/tools and countries', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    expect(await screen.findByRole('heading', { name: 'buyer@libas.in' })).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: 'User metrics' });
    expect(within(metrics).getByText('1,234')).toBeInTheDocument();
    expect(within(metrics).getByText('1.0% of requests')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Top pages' })).toHaveTextContent('/orders/:id');
    expect(screen.getByRole('list', { name: 'Top tools' })).toHaveTextContent('export-csv');
    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sessions/i }).getAttribute('href')).toBe(
      `/journeys?userKey=${USER_KEY}`,
    );
  });

  it('shows an "Online now" badge in the header only while the user is active', async () => {
    useProfileHandlers(200, {
      ...NOBODY_ONLINE,
      apps: [{ app: 'ebo-sales', users: 1, anonymous: 0 }],
      users: [
        {
          userKey: USER_KEY,
          email: 'buyer@libas.in',
          app: 'ebo-sales',
          sessionId: SESSION_ID,
          currentPage: '/orders/:id',
          lastEvent: {
            kind: 'page_view',
            path: '/orders/:id',
            tool: null,
            method: null,
            status: null,
            endpointId: null,
          },
          lastSeenAt: '2026-10-01T07:59:30.000Z',
          events: 4,
        },
      ],
    });
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    await screen.findByRole('heading', { name: 'buyer@libas.in' });
    expect(await screen.findByText(/Online now/)).toHaveTextContent(
      'Online now · in ebo-sales · on /orders/:id',
    );
  });

  it('shows no badge when the user is not online', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    await screen.findByRole('heading', { name: 'buyer@libas.in' });
    await screen.findByRole('table', { name: 'User activity' });
    expect(screen.queryByText(/Online now/)).toBeNull();
  });

  it('merges API calls, pages and tools in one timeline (IP only when sent, replay by id)', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    const table = await screen.findByRole('table', { name: 'User activity' });
    expect(await within(table).findByText('/api/orders/123')).toBeInTheDocument();
    expect(within(table).getByText('API call')).toBeInTheDocument();
    expect(within(table).getByText('Page view')).toBeInTheDocument();
    expect(within(table).getByText('1m 5s visible')).toBeInTheDocument();
    expect(within(table).getByText('export-csv')).toBeInTheDocument();
    expect(within(table).getAllByText('203.0.113.7')).toHaveLength(1);
    const replays = within(table).getAllByRole('link', { name: /replay/i });
    expect(replays).toHaveLength(2);
    expect(replays[0]?.getAttribute('href')).toBe(`/journeys/ebo-sales/${SESSION_ID}`);
  });

  it('turns a 404 (no activity in the window) into a friendly state with a wider-range button', async () => {
    useProfileHandlers(404);
    const urls: string[] = [];
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(await screen.findByText('No activity for this user in this range')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the last 7 days' }));
    expect(urls.at(-1)).toContain('range=7d');
  });

  it('keeps the no-activity state for a registered ?app=', async () => {
    useProfileHandlers(404);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      searchParams: '?app=ebo-sales&range=1h',
    });
    expect(await screen.findByText('No activity for this user in this range')).toBeInTheDocument();
  });

  it('shows the API message (not "no activity") when ?app= names an unknown app', async () => {
    useProfileHandlers(404);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      searchParams: '?app=old-slug&range=1h',
    });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('no activity for this user')).toBeInTheDocument();
    expect(screen.queryByText('No activity for this user in this range')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show the last/ })).toBeNull();
  });

  it('isNoActivity: a 404 is "no activity" without an app filter or for a registered app', () => {
    const notFound = new ApiError(404, ERROR_CODES.NOT_FOUND, 'not found', 'req-1');
    expect(isNoActivity(notFound, undefined, APPS)).toBe(true);
    expect(isNoActivity(notFound, 'ebo-sales', APPS)).toBe(true);
    expect(isNoActivity(notFound, 'old-slug', APPS)).toBe(false);
    // App list still loading (or failed): the common case wins.
    expect(isNoActivity(notFound, 'old-slug', undefined)).toBe(true);
    expect(isNoActivity(new Error('boom'), undefined, APPS)).toBe(false);
  });

  it('shows any other API error with its request id', async () => {
    useProfileHandlers(500);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Request ID req-7/)).toBeInTheDocument();
  });

  it('shows a breadcrumb trail back to Users that names the user by MASKED email only', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?range=7d' });
    await screen.findByRole('heading', { name: 'buyer@libas.in' });
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/users?range=7d',
    );
    expect(within(trail).getByText('b***@libas.in')).toHaveAttribute('aria-current', 'page');
    expect(trail).not.toHaveTextContent('buyer@libas.in');
  });

  it("shows the apps used and the top API routes, and links to the user's failures", async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?range=7d' });
    const routes = await screen.findByRole('list', { name: 'Top API routes' });
    expect(
      within(routes)
        .getByRole('link', { name: /\/api\/orders\/:id/ })
        .getAttribute('href'),
    ).toBe('/endpoints/6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11?range=7d');
    expect(screen.getByRole('table', { name: 'Apps used' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View failures/ }).getAttribute('href')).toBe(
      `/errors?range=7d&userKey=${USER_KEY}`,
    );
  });
});
