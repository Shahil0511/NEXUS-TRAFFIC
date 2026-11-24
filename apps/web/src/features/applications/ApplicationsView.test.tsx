import { ROUTES, type OnlineNowDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { COVERAGE_WARN_PCT, METRIC_COPY } from '@/lib/metricCopy';
import {
  APP_TRAFFIC,
  BREAKDOWN,
  DEVICE_RETURN,
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

/** Every panel of the app page except the audience ones (each test serves those itself). */
function serveDetailPanels() {
  server.use(
    http.get(routeUrl(ROUTES.overview.apps), () =>
      HttpResponse.json({ ...APP_TRAFFIC, items: [APP_TRAFFIC.items[0]] }),
    ),
    http.get(routeUrl(ROUTES.overview.timeseries), () => HttpResponse.json(OVERVIEW_TIMESERIES)),
    http.get(routeUrl(ROUTES.errors.summary), () => HttpResponse.json(ERROR_SUMMARY)),
    http.get(routeUrl(ROUTES.users.list), () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get(routeUrl(ROUTES.endpoints.list), () => HttpResponse.json(ENDPOINT_PAGE)),
    http.get(routeUrl(ROUTES.pages.list), () => HttpResponse.json(PAGE_STATS)),
    http.get(routeUrl(ROUTES.tools.usage), () => HttpResponse.json(TOOL_USAGE)),
  );
}

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
      http.get(routeUrl(ROUTES.overview.breakdown), scoped(BREAKDOWN)),
      http.get(routeUrl(ROUTES.overview.devices), scoped(DEVICE_RETURN)),
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
    await screen.findByRole('list', { name: 'Browsers and devices by browser' });
    // The path's app wins over the global filter, for every query on the page.
    expect([...apps]).toEqual(['ebo-sales']);
    expect(onlineQueries.map((params) => params.get('app'))).toEqual(['ebo-sales']);
    // "N online now" next to the header actions opens the Live page filtered to the app.
    const onlineLink = await screen.findByRole('link', { name: '6 online now' });
    expect(onlineLink.getAttribute('href')).toBe('/live?app=ebo-sales');
    // Data health opens narrowed to this app.
    expect(screen.getByRole('link', { name: /Data health/ }).getAttribute('href')).toBe(
      '/integration?app=ebo-sales',
    );
  });

  it('shows the audience: new vs returning devices and breakdowns, values as plain text', async () => {
    const breakdownQueries: URLSearchParams[] = [];
    const deviceQueries: URLSearchParams[] = [];
    serveDetailPanels();
    server.use(
      http.get(routeUrl(ROUTES.overview.breakdown), ({ request }) => {
        const params = new URL(request.url).searchParams;
        breakdownQueries.push(params);
        return HttpResponse.json(
          params.get('dimension') === 'release'
            ? {
                ...BREAKDOWN,
                dimension: 'release',
                items: [{ value: '<img src=x onerror=alert(1)>', events: 5, share: 0.5 }],
              }
            : BREAKDOWN,
        );
      }),
      http.get(routeUrl(ROUTES.overview.devices), ({ request }) => {
        deviceQueries.push(new URL(request.url).searchParams);
        return HttpResponse.json(DEVICE_RETURN);
      }),
    );
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />, {
      searchParams: '?range=7d&env=staging',
    });

    const audience = await screen.findByRole('region', { name: 'Audience' });
    expect(await within(audience).findByText('150')).toBeInTheDocument();
    expect(
      within(audience).getByRole('button', { name: 'What is Returning?' }),
    ).toBeInTheDocument();
    expect(within(audience).getByText(/of devices came back/)).toHaveTextContent('75%');

    const browsers = await within(audience).findByRole('list', {
      name: 'Browsers and devices by browser',
    });
    expect(within(browsers).getByText('Chrome')).toBeInTheDocument();
    expect(within(browsers).getByText('Not sent')).toBeInTheDocument();
    expect(within(browsers).getByText('64.0% of 1,000 events')).toBeInTheDocument();

    // Ingested values render as text, never as markup.
    const releases = await within(audience).findByRole('list', {
      name: 'Releases and navigation by release',
    });
    expect(within(releases).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();

    // Every audience query follows the page: the app from the path, the range and the environment.
    for (const params of [...breakdownQueries, ...deviceQueries]) {
      expect(params.get('app')).toBe('ebo-sales');
      expect(params.get('range')).toBe('7d');
      expect(params.get('env')).toBe('staging');
    }
    expect(new Set(breakdownQueries.map((params) => params.get('source')))).toEqual(
      new Set(['browser']),
    );
  });

  it('switches a breakdown to another dimension in place', async () => {
    const dimensions: (string | null)[] = [];
    serveDetailPanels();
    server.use(
      http.get(routeUrl(ROUTES.overview.breakdown), ({ request }) => {
        const dimension = new URL(request.url).searchParams.get('dimension');
        dimensions.push(dimension);
        return HttpResponse.json(
          dimension === 'client_tz'
            ? {
                ...BREAKDOWN,
                dimension: 'client_tz',
                items: [{ value: 'Asia/Kolkata', events: 900, share: 0.9 }],
              }
            : BREAKDOWN,
        );
      }),
      http.get(routeUrl(ROUTES.overview.devices), () => HttpResponse.json(DEVICE_RETURN)),
    );
    const user = userEvent.setup();
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />);

    await screen.findByRole('list', { name: 'Browsers and devices by browser' });
    await user.click(screen.getByRole('combobox', { name: 'Browsers and devices: dimension' }));
    await user.click(await screen.findByRole('option', { name: 'Time zone' }));

    const zones = await screen.findByRole('list', { name: 'Browsers and devices by time zone' });
    expect(within(zones).getByText('Asia/Kolkata')).toBeInTheDocument();
    expect(dimensions).toContain('client_tz');
  });
});

describe('ApplicationsView coverage cells', () => {
  it('flags a low linked share amber against the shared coverage target', async () => {
    server.use(http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)));
    renderWithProviders(<ApplicationsView />);
    const table = await screen.findByRole('table', { name: 'Applications' });
    expect(
      await within(table).findByLabelText(
        '71% of linkable API calls are linked to a browser session (low)',
      ),
    ).toBeInTheDocument();
    expect(
      within(table).getByLabelText('97% of events (both sources combined) carry a verified user'),
    ).toBeInTheDocument();
  });
});
