import { ROUTES, type OnlineNowDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { COVERAGE_WARN_PCT, METRIC_COPY } from '@/lib/metricCopy';
import {
  APP_TRAFFIC,
  ENDPOINT_PAGE,
  ERROR_SUMMARY,
  OVERVIEW_TIMESERIES,
  PAGE_STATS,
  TOOL_USAGE,
  USER_KEY,
  userSummary,
} from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { ApplicationDetailView } from './ApplicationDetailView';
import { ApplicationsView } from './ApplicationsView';

const ONLINE: OnlineNowDto = {
  asOf: '2026-10-01T08:00:00.000Z',
  windowMs: 300_000,
  apps: [{ app: 'ebo-sales', users: 4, anonymous: 2 }],
  users: [],
};

/** Who is online (every test page asks); recorded so a test can check the query. */
const onlineQueries: URLSearchParams[] = [];
beforeEach(() => {
  onlineQueries.length = 0;
  server.use(
    http.get(routeUrl(ROUTES.live.online), ({ request }) => {
      const params = new URL(request.url).searchParams;
      onlineQueries.push(params);
      const app = params.get('app');
      return HttpResponse.json(
        app ? { ...ONLINE, apps: ONLINE.apps.filter((item) => item.app === app) } : ONLINE,
      );
    }),
  );
});

describe('ApplicationsView', () => {
  it('lists every app with its numbers; a silent app is flagged; each opens its page', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.overview.apps), ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(APP_TRAFFIC);
      }),
    );
    renderWithProviders(<ApplicationsView />, { searchParams: '?range=7d&app=hr-portal' });

    const table = await screen.findByRole('table', { name: 'Applications' });
    const ebo = await within(table).findByRole('link', { name: /EBO Sales/ });
    // The global app filter neither narrows this page nor leaks into its links.
    expect(ebo.getAttribute('href')).toBe('/applications/ebo-sales?range=7d');
    expect(seen[0]?.get('app')).toBeNull();
    expect(within(table).getByText('38')).toBeInTheDocument();
    expect(within(table).getByText('no data')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });
});

describe('ApplicationsView online now', () => {
  it('shows people online per app (users + anonymous), "—" for an app with nobody', async () => {
    server.use(http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)));
    renderWithProviders(<ApplicationsView />, { searchParams: '?range=7d&app=hr-portal' });
    const table = await screen.findByRole('table', { name: 'Applications' });
    expect(within(table).getByRole('columnheader', { name: /Online now/ })).toBeInTheDocument();
    expect(await within(table).findByRole('cell', { name: '6 online now' })).toBeInTheDocument();
    const [, ebo, hr] = within(table).getAllByRole('row');
    expect(within(ebo!).getByRole('cell', { name: '6 online now' })).toBeInTheDocument();
    expect(within(hr!).queryByRole('cell', { name: /online now/ })).toBeNull();
    expect(within(hr!).getAllByText('—').length).toBeGreaterThan(0);
    // Online is always "now" and covers every app: neither the range nor the app filter apply.
    expect(onlineQueries[0]?.toString()).toBe('');
  });

  it('explains the column', async () => {
    server.use(http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)));
    const user = userEvent.setup();
    renderWithProviders(<ApplicationsView />);
    const table = await screen.findByRole('table', { name: 'Applications' });
    await user.click(within(table).getByRole('button', { name: 'What is Online now?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(METRIC_COPY.onlineNow.short);
  });
});

describe('ApplicationsView metric explanations', () => {
  it('explains Identified / Linked (and the 80 % threshold) in the column headers', async () => {
    server.use(http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)));
    const user = userEvent.setup();
    renderWithProviders(<ApplicationsView />);
    const table = await screen.findByRole('table', { name: 'Applications' });
    for (const header of ['Users', 'API calls', 'Error rate', 'p95', 'Identified', 'Linked']) {
      expect(within(table).getByRole('button', { name: `What is ${header}?` })).toBeInTheDocument();
    }
    await user.click(within(table).getByRole('button', { name: 'What is Linked?' }));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(METRIC_COPY.linkedPct.short);
    expect(tip).toHaveTextContent(`Below ${COVERAGE_WARN_PCT} % is highlighted`);
  });
});

describe('ApplicationDetailView', () => {
  it('shows who uses the app and what they use, every panel scoped to the app', async () => {
    const apps = new Set<string | null>();
    const scoped =
      (body: JsonBodyType) =>
      ({ request }: { request: Request }) => {
        apps.add(new URL(request.url).searchParams.get('app'));
        return HttpResponse.json(body);
      };
    server.use(
      http.get(
        routeUrl(ROUTES.overview.apps),
        scoped({ ...APP_TRAFFIC, items: [APP_TRAFFIC.items[0]] }),
      ),
      http.get(routeUrl(ROUTES.overview.timeseries), scoped(OVERVIEW_TIMESERIES)),
      http.get(routeUrl(ROUTES.errors.summary), scoped(ERROR_SUMMARY)),
      http.get(routeUrl(ROUTES.users.list), scoped({ items: [userSummary()], nextCursor: null })),
      http.get(routeUrl(ROUTES.endpoints.list), scoped(ENDPOINT_PAGE)),
      http.get(routeUrl(ROUTES.pages.list), scoped(PAGE_STATS)),
      http.get(routeUrl(ROUTES.tools.usage), scoped(TOOL_USAGE)),
    );
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />, {
      searchParams: '?range=7d&app=other-app',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'EBO Sales' })).toBeInTheDocument();
    const users = await screen.findByRole('list', { name: 'Users of this app' });
    expect(within(users).getByRole('link', { name: 'buyer@libas.in' }).getAttribute('href')).toBe(
      `/users/${USER_KEY}?app=ebo-sales&range=7d`,
    );
    const metrics = screen.getByRole('region', { name: 'Application metrics' });
    expect(
      within(metrics)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toContain('/users?app=ebo-sales&range=7d');
    await screen.findByRole('list', { name: 'Most used tools' });
    // The path's app wins over the global filter, for every query on the page.
    expect([...apps]).toEqual(['ebo-sales']);
    expect(onlineQueries.map((params) => params.get('app'))).toEqual(['ebo-sales']);
    // "N online now" next to the header actions opens the Live page filtered to the app.
    const onlineLink = await screen.findByRole('link', { name: '6 online now' });
    expect(onlineLink.getAttribute('href')).toBe('/live?app=ebo-sales');
  });
});
