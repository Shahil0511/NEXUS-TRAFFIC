import { ROUTES, type OnlineNowDto } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { WHO_ADMINS_ONLY } from '@/components/AdminsOnlyNote';
import { NOT_CAPTURED } from '@/components/FactSheet';
import { COVERAGE_WARN_PCT, METRIC_COPY } from '@/lib/metricCopy';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { appHealth, INTEGRATION_HEALTH } from '@/test/adminFixtures';
import {
  APP_TRAFFIC,
  appTraffic,
  BREAKDOWN,
  DEVICE_RETURN,
  ENDPOINT_PAGE,
  ERROR_SUMMARY,
  ME,
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
    // Data health per app (the list's marks): ebo-sales has a red warning, hr-portal never sent.
    http.get(routeUrl(ROUTES.integration.health), () => HttpResponse.json(INTEGRATION_HEALTH)),
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
    // The list's copy uses neutral words only.
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});

describe('ApplicationsView headline', () => {
  it('states the totals in one sentence with the links of the old cards, and no card row', async () => {
    server.use(
      http.get(routeUrl(ROUTES.overview.apps), () =>
        HttpResponse.json({
          ...APP_TRAFFIC,
          items: [
            ...APP_TRAFFIC.items,
            appTraffic({
              app: 'crm',
              displayName: 'CRM',
              requests: { value: 1_000, previous: 900, deltaPct: 11.11 },
              errorRate: { value: 7, previous: 2, deltaPct: 250 },
            }),
          ],
        }),
      ),
    );
    renderWithProviders(<ApplicationsView />, { searchParams: '?range=7d&env=staging' });
    const table = await screen.findByRole('table', { name: 'Applications' });
    await within(table).findByRole('link', { name: /CRM/ });

    expect(screen.queryByRole('region', { name: 'Totals' })).toBeNull();
    expect(screen.queryByText('Registered apps')).toBeNull();

    const sentence = screen.getByText(/apps registered\./).closest('p')!;
    expect(sentence).toHaveTextContent(
      '3 apps registered. 2 of 3 sent data in this range. 10K API calls in total. 1 app with an error rate of 5 % or more.',
    );
    // Data health (no range there), Request types and Problems, with the page's filters.
    expect(within(sentence).getByRole('link', { name: '2 of 3' })).toHaveAttribute(
      'href',
      '/integration',
    );
    expect(within(sentence).getByRole('link', { name: '10K' })).toHaveAttribute(
      'href',
      '/endpoints?range=7d&env=staging',
    );
    const failing = within(sentence).getByRole('link', { name: '1 app' });
    expect(failing).toHaveAttribute('href', '/errors?range=7d&env=staging');
    expect(failing.closest('strong')).toHaveClass('text-destructive');
    for (const label of ['Sending data', 'API calls', 'Error rate ≥ 5 %']) {
      expect(
        within(sentence).getByRole('button', { name: `What is ${label}?` }),
      ).toBeInTheDocument();
    }
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});

describe('ApplicationsView Data health marks', () => {
  it('starts each row with its Data health mark; an app without an entry has none', async () => {
    server.use(
      http.get(routeUrl(ROUTES.overview.apps), () =>
        HttpResponse.json({
          ...APP_TRAFFIC,
          items: [
            ...APP_TRAFFIC.items,
            appTraffic({ app: 'crm', displayName: 'CRM' }),
            appTraffic({ app: 'stock', displayName: 'Stock' }),
          ],
        }),
      ),
      http.get(routeUrl(ROUTES.integration.health), () =>
        HttpResponse.json({
          ...INTEGRATION_HEALTH,
          apps: [
            ...INTEGRATION_HEALTH.apps,
            appHealth({ app: 'crm', displayName: 'CRM', status: 'healthy', warnings: [] }),
          ],
        }),
      ),
    );
    renderWithProviders(<ApplicationsView />);
    const table = await screen.findByRole('table', { name: 'Applications' });
    const link = (name: RegExp) => within(table).getByRole('link', { name });

    await within(table).findByText('Data health: Healthy');
    expect(link(/CRM/)).toHaveTextContent('Data health: Healthy');
    expect(link(/EBO Sales/)).toHaveTextContent('Data health: Action needed');
    expect(link(/HR Portal/)).toHaveTextContent('Data health: Needs attention');
    expect(link(/Stock/)).not.toHaveTextContent('Data health');
  });

  it('still renders the table when the Data health read fails, just without marks', async () => {
    let healthServed = false;
    server.use(
      http.get(routeUrl(ROUTES.overview.apps), () => HttpResponse.json(APP_TRAFFIC)),
      http.get(routeUrl(ROUTES.integration.health), () => {
        healthServed = true;
        return HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 });
      }),
    );
    renderWithProviders(<ApplicationsView />);
    const table = await screen.findByRole('table', { name: 'Applications' });
    // Wait for the 500 to be served, then for the view to settle after it.
    await waitFor(() => expect(healthServed).toBe(true));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Applications' })).getByRole('link', {
          name: /EBO Sales/,
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('table', { name: 'Applications' })).toBe(table);
    expect(within(table).queryByText(/Data health:/)).toBeNull();
    expect(screen.getByText(/apps registered\./)).toBeInTheDocument();
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
    const userSorts: (string | null)[] = [];
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
      http.get(routeUrl(ROUTES.users.list), (info) => {
        userSorts.push(new URL(info.request.url).searchParams.get('sort'));
        return scoped({ items: [userSummary()], nextCursor: null })(info);
      }),
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
    // "Who uses it" lists the people with the most API calls first, and its description says so (ADR 0018).
    expect([...new Set(userSorts)]).toEqual(['requests']);
    expect(screen.getByText('Verified people, most API calls first')).toBeInTheDocument();
    // "All users of this app" opens the People list in the same order as the panel.
    const allUsers = screen.getByRole('link', { name: /All users of this app/ });
    expect(new URL(allUsers.getAttribute('href')!, 'http://x').searchParams.get('sort')).toBe(
      'requests',
    );
    // The panel's person-level copy uses neutral words only (ADR 0017).
    const usersPanel = users.closest('[aria-labelledby]');
    expect(usersPanel).toHaveTextContent('Who uses it');
    expect(findBannedWords(collectRenderedText(usersPanel as Element))).toEqual([]);
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

  it('shows a viewer the count of people and the note, and sends no users read (ADR 0019)', async () => {
    const userReads: string[] = [];
    serveDetailPanels();
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json({ ...ME, isAdmin: false })),
      http.get(routeUrl(ROUTES.users.list), ({ request }) => {
        userReads.push(request.url);
        return HttpResponse.json({ items: [userSummary()], nextCursor: null });
      }),
      http.get(routeUrl(ROUTES.overview.breakdown), () => HttpResponse.json(BREAKDOWN)),
      http.get(routeUrl(ROUTES.overview.devices), () => HttpResponse.json(DEVICE_RETURN)),
    );
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />, { searchParams: '?range=7d' });

    expect(await screen.findByRole('heading', { level: 1, name: 'EBO Sales' })).toBeInTheDocument();
    const panel = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(
      await within(panel).findByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === '38 verified people used this app in this range.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText(WHO_ADMINS_ONLY)).toBeInTheDocument();
    expect(within(panel).queryByRole('list')).toBeNull();
    // The People list stays open to every viewer (ADR 0019 point 4), so its entry point stays too.
    const allUsers = within(panel).getByRole('link', { name: /All users of this app/ });
    expect(new URL(allUsers.getAttribute('href')!, 'http://x').searchParams.get('sort')).toBe(
      'requests',
    );
    await screen.findByRole('list', { name: 'Most used tools' });
    expect(userReads).toEqual([]);
    expect(document.body.textContent).not.toContain('buyer@libas.in');
    expect(findBannedWords(collectRenderedText(panel))).toEqual([]);
  });

  it('shows a failed /me read as an error with a retry, never as the viewer state', async () => {
    const userReads: string[] = [];
    serveDetailPanels();
    server.use(
      http.get(routeUrl(ROUTES.me.get), () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
      http.get(routeUrl(ROUTES.users.list), ({ request }) => {
        userReads.push(request.url);
        return HttpResponse.json({ items: [userSummary()], nextCursor: null });
      }),
      http.get(routeUrl(ROUTES.overview.breakdown), () => HttpResponse.json(BREAKDOWN)),
      http.get(routeUrl(ROUTES.overview.devices), () => HttpResponse.json(DEVICE_RETURN)),
    );
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />, { searchParams: '?range=7d' });

    expect(await screen.findByRole('heading', { level: 1, name: 'EBO Sales' })).toBeInTheDocument();
    const panel = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(await within(panel).findByRole('alert')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(within(panel).queryByText(WHO_ADMINS_ONLY)).toBeNull();
    await screen.findByRole('list', { name: 'Most used tools' });
    expect(userReads).toEqual([]);
  });

  it('says "not captured" to a viewer when the app row has no people count', async () => {
    serveDetailPanels();
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json({ ...ME, isAdmin: false })),
      http.get(routeUrl(ROUTES.overview.apps), () =>
        HttpResponse.json({
          ...APP_TRAFFIC,
          items: [
            {
              ...APP_TRAFFIC.items[0]!,
              users: { ...APP_TRAFFIC.items[0]!.users, value: null },
            },
          ],
        }),
      ),
      http.get(routeUrl(ROUTES.overview.breakdown), () => HttpResponse.json(BREAKDOWN)),
      http.get(routeUrl(ROUTES.overview.devices), () => HttpResponse.json(DEVICE_RETURN)),
    );
    renderWithProviders(<ApplicationDetailView app="ebo-sales" />, { searchParams: '?range=7d' });

    expect(await screen.findByRole('heading', { level: 1, name: 'EBO Sales' })).toBeInTheDocument();
    const panel = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(await within(panel).findByText(NOT_CAPTURED)).toBeInTheDocument();
    expect(panel.textContent).not.toContain('0 verified people');
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
