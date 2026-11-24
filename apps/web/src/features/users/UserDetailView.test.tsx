import { ERROR_CODES, ROUTES, type MeDto, type OnlineNowDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/apiError';
import {
  APPS,
  ME,
  SESSION_ID,
  timelineItem,
  USER_DAILY,
  USER_DEVICES,
  USER_KEY,
  USER_PROFILE,
} from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { isForbidden, isNoActivity, UserDetailView } from './UserDetailView';

const NOBODY_ONLINE: OnlineNowDto = {
  asOf: '2026-10-01T08:00:00.000Z',
  windowMs: 300_000,
  apps: [],
  users: [],
};

const NOT_ADMIN: MeDto = { email: 'viewer@libas.in', isAdmin: false };

function useProfileHandlers(profileStatus = 200, online: OnlineNowDto = NOBODY_ONLINE): void {
  server.use(
    http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(ME)),
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
    http.get(routeUrl(ROUTES.users.devices), () => HttpResponse.json(USER_DEVICES)),
    http.get(routeUrl(ROUTES.users.daily), () => HttpResponse.json(USER_DAILY)),
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
    expect(screen.getByRole('link', { name: /view visits/i }).getAttribute('href')).toBe(
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
    expect(
      await screen.findByText('Online now · in ebo-sales · on /orders/:id', {
        selector: '.sr-only',
      }),
    ).toBeInTheDocument();
  });

  it('shows no badge when the user is not online', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=activity' });
    await screen.findByRole('heading', { name: 'buyer@libas.in' });
    await screen.findByRole('table', { name: 'User activity' });
    expect(screen.queryByText(/Online now/)).toBeNull();
  });

  it('merges API calls, pages and tools in one timeline (IP only when sent, replay by id)', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=activity' });
    const table = await screen.findByRole('table', { name: 'User activity' });
    expect(await within(table).findByText('/api/orders/123')).toBeInTheDocument();
    expect(within(table).getByText('API call')).toBeInTheDocument();
    expect(within(table).getByText('Page view')).toBeInTheDocument();
    expect(within(table).getByText('1m 5s visible')).toBeInTheDocument();
    expect(within(table).getByText('export-csv')).toBeInTheDocument();
    expect(within(table).getAllByText('203.0.113.7')).toHaveLength(1);
    const replays = within(table).getAllByRole('link', { name: /visit steps/i });
    expect(replays).toHaveLength(2);
    expect(replays[0]?.getAttribute('href')).toBe(`/journeys/ebo-sales/${SESSION_ID}`);
  });

  it('turns a 404 (no activity in the window) into a friendly state with a wider-range button', async () => {
    useProfileHandlers(404);
    const urls: string[] = [];
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(
      await screen.findByText('No activity for this person in this range'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the last 7 days' }));
    expect(urls.at(-1)).toContain('range=7d');
  });

  it('keeps the no-activity state for a registered ?app=', async () => {
    useProfileHandlers(404);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      searchParams: '?app=ebo-sales&range=1h',
    });
    expect(
      await screen.findByText('No activity for this person in this range'),
    ).toBeInTheDocument();
  });

  it('shows the API message (not "no activity") when ?app= names an unknown app', async () => {
    useProfileHandlers(404);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      searchParams: '?app=old-slug&range=1h',
    });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('no activity for this user')).toBeInTheDocument();
    expect(screen.queryByText('No activity for this person in this range')).toBeNull();
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
    // The card says the facts failed, without pointing at a tab that is not on screen.
    const card = screen.getByRole('complementary', { name: 'About this person' });
    expect(within(card).getByText('Could not load these facts.')).toBeInTheDocument();
    expect(within(card).queryByText(/Devices tab/)).toBeNull();
  });

  it('shows a breadcrumb trail back to Users that names the user by MASKED email only', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?range=7d' });
    await screen.findByRole('heading', { name: 'buyer@libas.in' });
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'People' })).toHaveAttribute(
      'href',
      '/users?range=7d',
    );
    expect(within(trail).getByText('b***@libas.in')).toHaveAttribute('aria-current', 'page');
    expect(trail).not.toHaveTextContent('buyer@libas.in');
  });

  it("shows the apps used and the top API routes, and links to the user's failures", async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?range=7d' });
    const routes = await screen.findByRole('list', { name: 'Top request types' });
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

  it('keeps the identity card with the latest known facts next to every tab', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=devices' });
    const card = await screen.findByRole('complementary', { name: 'About this person' });
    const latest = await within(card).findByRole('region', { name: 'Latest known' });
    expect(within(latest).getByText('Desktop')).toBeInTheDocument();
    expect(within(latest).getByText('Chrome 126')).toBeInTheDocument();
    expect(within(latest).getByText('Asia/Kolkata')).toBeInTheDocument();
    expect(within(latest).getByText('en-IN')).toBeInTheDocument();
    expect(within(latest).getByText('2026.11.3')).toBeInTheDocument();
    expect(within(card).getByText('buyer@libas.in')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Copy email' })).toBeInTheDocument();
  });

  it('says so when the range holds no browser activity (server events only)', async () => {
    useProfileHandlers();
    server.use(
      http.get(routeUrl(ROUTES.users.profile), () =>
        HttpResponse.json({ ...USER_PROFILE, latest: null }),
      ),
    );
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    expect(await screen.findByText(/No browser activity in this range/)).toBeInTheDocument();
  });

  it('opens the tab named in ?tab= and writes a tab change back to the URL', async () => {
    useProfileHandlers();
    const urls: string[] = [];
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, {
      searchParams: '?range=7d',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await screen.findByRole('region', { name: 'User metrics' });
    // Its own name (the identity card is "About this person"); wraps on a phone, never clips.
    expect(screen.getByRole('tablist', { name: 'Person page sections' })).toHaveClass('flex-wrap');
    expect(screen.getByRole('tab', { name: /Summary/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.setup().click(screen.getByRole('tab', { name: /Daily activity/ }));
    expect(urls.at(-1)).toContain('tab=daily');
    expect(await screen.findByRole('table', { name: 'Daily activity' })).toBeInTheDocument();
  });

  it('daily activity: one row per day with times, the day strip and the window totals', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=daily' });
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    await within(table).findByText('3 h 12 min');
    const rows = within(table).getAllByRole('row');
    // header + two days, newest first
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/1 Oct/);
    expect(rows[1]).toHaveTextContent('09:10');
    expect(rows[1]).toHaveTextContent('18:40');
    expect(rows[1]).toHaveTextContent('3 h 12 min');
    expect(rows[1]).toHaveTextContent('3 failed');
    expect(rows[2]).toHaveTextContent('48 min');
    expect(rows[2]).not.toHaveTextContent('failed');
    // The day strip is decorative: the times are already printed as text above it.
    expect(within(table).queryByRole('img')).toBeNull();
    expect(table.querySelector('[data-slot="day-strip"]')).toHaveAttribute('aria-hidden', 'true');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent ?? '');
    for (const header of [
      'Date',
      'First – last activity (IST)',
      'Tab visible time',
      'Apps',
      'Pages and calls',
      'Visits',
    ]) {
      expect(
        headers.some((text) => text.includes(header)),
        header,
      ).toBe(true);
    }

    const totals = screen.getByRole('region', { name: 'Daily activity totals' });
    expect(within(totals).getByText('2')).toBeInTheDocument();
    expect(within(totals).getByText('09:35 IST')).toBeInTheDocument();
    expect(within(totals).getByText('16:00 IST')).toBeInTheDocument();
    expect(within(totals).getByText('4 h')).toBeInTheDocument();
  });

  it('devices: one row per device type, browser and OS, unknown parts named', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=devices' });
    const table = await screen.findByRole('table', { name: 'Devices' });
    await within(table).findByText('Chrome 126');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Desktop');
    expect(rows[1]).toHaveTextContent('Chrome 126');
    expect(rows[1]).toHaveTextContent('Windows 10');
    expect(rows[1]).toHaveTextContent('1,200');
    expect(within(rows[2] as HTMLElement).getAllByText('Unknown')).toHaveLength(3);
  });

  it('shows macOS without the version browsers freeze in the User-Agent', async () => {
    useProfileHandlers();
    server.use(
      http.get(routeUrl(ROUTES.users.profile), () =>
        HttpResponse.json({
          ...USER_PROFILE,
          latest: { ...USER_PROFILE.latest!, os: 'Mac OS 10' },
        }),
      ),
      http.get(routeUrl(ROUTES.users.devices), () =>
        HttpResponse.json({
          ...USER_DEVICES,
          items: [{ ...USER_DEVICES.items[0]!, os: 'Mac OS 10' }],
        }),
      ),
    );
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=devices' });
    const table = await screen.findByRole('table', { name: 'Devices' });
    expect(await within(table).findByText('macOS')).toBeInTheDocument();
    const latest = screen.getByRole('region', { name: 'Latest known' });
    expect(within(latest).getByText('macOS')).toBeInTheDocument();
    expect(screen.queryByText(/Mac OS 10/)).toBeNull();
    // The source line names the app in one plain sentence.
    expect(
      within(latest).getByText(/^From the latest browser activity, .+ IST in ebo-sales\.$/),
    ).toBeInTheDocument();
  });

  it('keeps the identity card on screen when the range holds no activity', async () => {
    useProfileHandlers(404);
    server.use(
      http.get(routeUrl(ROUTES.users.devices), () =>
        HttpResponse.json({ ...USER_DEVICES, items: [], latest: null }),
      ),
    );
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    expect(
      await screen.findByText('No activity for this person in this range'),
    ).toBeInTheDocument();
    const card = screen.getByRole('complementary', { name: 'About this person' });
    expect(within(card).getByText('No activity in this range')).toBeInTheDocument();
    // "Nothing in this range" is not a failure: no "could not load", no hidden Devices tab.
    expect(within(card).getByText(/No browser activity in this range/)).toBeInTheDocument();
    expect(within(card).queryByText(/Could not load/)).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

describe('UserDetailView — admins only', () => {
  /** Counts every person-level request (none may be sent for a non-admin). */
  function countPersonReads(): { reads: number } {
    const counter = { reads: 0 };
    const count = (route: (typeof PERSON_ROUTES)[number]): HttpHandler =>
      http.get(routeUrl(route), () => {
        counter.reads += 1;
        return HttpResponse.json({}, { status: 500 });
      });
    server.use(...PERSON_ROUTES.map(count));
    return counter;
  }

  const PERSON_ROUTES = [
    ROUTES.users.profile,
    ROUTES.users.timeline,
    ROUTES.users.devices,
    ROUTES.users.daily,
  ] as const;

  it('a non-admin sees the admins-only state and NO person read is sent', async () => {
    server.use(http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(NOT_ADMIN)));
    const counter = countPersonReads();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    const state = await screen.findByRole('status');
    expect(
      within(state).getByRole('heading', { name: "Only admins can open a person's page" }),
    ).toBeInTheDocument();
    expect(within(state).getByRole('link', { name: 'Back to People' })).toHaveAttribute(
      'href',
      '/users',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(counter.reads).toBe(0);
  });

  it('a 403 from the API shows the same state, not a generic error', async () => {
    useProfileHandlers();
    server.use(
      http.get(routeUrl(ROUTES.users.profile), () =>
        HttpResponse.json(
          {
            error: {
              code: ERROR_CODES.FORBIDDEN,
              message: 'Admin access required',
              requestId: 'r',
            },
          },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    expect(
      await screen.findByRole('heading', { name: "Only admins can open a person's page" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Admin access required')).toBeNull();
  });

  it('isForbidden: only a 403 FORBIDDEN envelope counts', () => {
    expect(isForbidden(new ApiError(403, ERROR_CODES.FORBIDDEN, 'no', 'r'))).toBe(true);
    expect(isForbidden(new ApiError(403, ERROR_CODES.CSRF_HEADER_MISSING, 'no', 'r'))).toBe(false);
    expect(isForbidden(new ApiError(404, ERROR_CODES.NOT_FOUND, 'no', 'r'))).toBe(false);
    expect(isForbidden(new Error('boom'))).toBe(false);
  });
});
