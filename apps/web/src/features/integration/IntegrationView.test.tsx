import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { appHealth, INTEGRATION_HEALTH } from '@/test/adminFixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import type { DashboardAccess } from './dashboardAccessCheck';
import { formatAgo, formatSkew } from './integrationCopy';
import { IntegrationView, tallyHealth } from './IntegrationView';

type User = ReturnType<typeof userEvent.setup>;

function serve(body = INTEGRATION_HEALTH) {
  server.use(http.get(routeUrl(ROUTES.integration.health), () => HttpResponse.json(body)));
}

function renderView(
  options: { access?: DashboardAccess; searchParams?: string } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<IntegrationView dashboardAccess={options.access ?? 'listed'} />, {
    searchParams: options.searchParams,
  });
}

/** The checklist row of one app (found through its "Show / Hide details for …" toggle). */
async function rowOf(name: string): Promise<HTMLElement> {
  const toggle = await screen.findByRole('button', { name: new RegExp(`details for ${name}$`) });
  return toggle.closest<HTMLElement>('[data-slot="check-row"]')!;
}

/** Opens an app's row and returns its details region (every block of the old card). */
async function openRow(user: User, name: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: `Show details for ${name}` }));
  return screen.getByRole('region', { name });
}

/** The page's headline sentence, as text. */
async function headlineText(): Promise<string> {
  const sentence = await screen.findByText(/apps? healthy/);
  return sentence.closest('p')?.textContent ?? '';
}

describe('IntegrationView', () => {
  it('renders one row per app with status, warnings, counters, SDKs and guide links', async () => {
    serve();
    const user = userEvent.setup();
    renderView();

    const salesRow = await rowOf('EBO Sales');
    expect(within(salesRow).getByText('Healthy')).toBeInTheDocument();
    expect(within(salesRow).getByText('Action needed')).toBeInTheDocument();
    // One-line summary = the first warning; "How to fix" opens its chapter.
    expect(within(salesRow).getAllByText('Secret key exposed').length).toBeGreaterThan(0);
    expect(
      within(salesRow).getByRole('link', { name: 'How to fix: Secret key exposed' }),
    ).toHaveAttribute('href', '/traffic/api/docs/#01-getting-keys');
    expect(within(salesRow).getByRole('link', { name: /View traffic/ })).toHaveAttribute(
      'href',
      '/applications/ebo-sales',
    );

    const sales = await openRow(user, 'EBO Sales');
    const warnings = within(sales).getByRole('list', { name: 'Warnings for EBO Sales' });
    expect(within(warnings).getByText('Secret key exposed')).toBeInTheDocument();
    expect(within(warnings).getByText('Proxy IPs instead of users')).toBeInTheDocument();
    // The proxy-IP warning says what it costs on the dashboard, not only how to fix it.
    expect(
      within(warnings).getByText(/places \(country and city\) stay empty/),
    ).toBeInTheDocument();
    expect(within(sales).getByRole('button', { name: 'Copy app slug' })).toBeInTheDocument();
    expect(within(warnings).getByText('Events rejected')).toBeInTheDocument();
    const fixes = within(warnings).getAllByRole('link', { name: /How to fix/ });
    expect(fixes.map((link) => link.getAttribute('href'))).toEqual([
      '/traffic/api/docs/#01-getting-keys',
      '/traffic/api/docs/#06-client-ip',
      '/traffic/api/docs/#04-responses-retries',
    ]);

    const serverStats = within(sales).getByRole('region', { name: 'Server events' });
    expect(within(serverStats).getByText('4,200')).toBeInTheDocument();
    expect(within(serverStats).getByText('2 min ago')).toBeInTheDocument();

    const sdks = within(sales).getByRole('table', { name: 'SDKs of EBO Sales' });
    // Name and version in their own columns (split by the API at the last '@').
    expect(within(sdks).getByRole('columnheader', { name: 'Version' })).toBeInTheDocument();
    expect(within(sdks).getByText('@nexus/express')).toBeInTheDocument();
    expect(within(sdks).getAllByText('1.0.0')).toHaveLength(2);
    expect(within(sdks).getByText('+120 ms')).toBeInTheDocument();
    expect(within(sdks).getByText('−1.5 s')).toBeInTheDocument();

    expect(within(sales).getByText('97% of server events')).toBeInTheDocument();
    expect(within(sales).getByRole('link', { name: /Rotate nx_sk_AbCd1234/ })).toHaveAttribute(
      'href',
      '/apps',
    );

    const hrRow = await rowOf('HR Portal');
    expect(within(hrRow).getByText('No events yet')).toBeInTheDocument();
    expect(within(hrRow).getByText('Needs attention')).toBeInTheDocument();
    const hr = await openRow(user, 'HR Portal');
    expect(within(hr).getByText('No events received')).toBeInTheDocument();
    expect(within(hr).getByText('No SDK seen in the last 24 hours')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Integration guide/ })).toHaveAttribute(
      'href',
      '/traffic/api/docs/',
    );
    expect(screen.getByRole('link', { name: /Verify steps/ })).toHaveAttribute(
      'href',
      '/traffic/api/docs/#10-verify',
    );
    expect(screen.getByText(/Last 24 hours · checked/)).toBeInTheDocument();

    // Nothing on the page (rows open) uses a banned word.
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('keeps rows closed until asked, and closes them again', async () => {
    serve();
    const user = userEvent.setup();
    renderView();
    const toggle = await screen.findByRole('button', { name: 'Show details for EBO Sales' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'EBO Sales' })).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide details for EBO Sales' }));
    expect(screen.queryByRole('region', { name: 'EBO Sales' })).toBeNull();
  });

  it('orders the rows: action needed, then needs attention, then healthy, each by name', async () => {
    serve({
      ...INTEGRATION_HEALTH,
      apps: [
        appHealth({ app: 'a-ok', displayName: 'Alpha', warnings: [] }),
        appHealth({ app: 'z-stale', displayName: 'Zulu', status: 'stale', warnings: ['stale'] }),
        appHealth({ app: 'm-key', displayName: 'Mike', warnings: ['exposed_key'] }),
      ],
    });
    renderView();
    const list = await screen.findByRole('list', { name: 'App checks' });
    const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-slot="check-row"]'));
    expect(rows.map((row) => row.dataset.state)).toEqual(['fail', 'warn', 'pass']);
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual([
      'Show details for Mike',
      'Show details for Zulu',
      'Show details for Alpha',
    ]);
    // A healthy app's summary: sending, best identified share, add-on version; no fix link.
    expect(
      within(rows[2]!).getByText('Sending · people identified 95% · add-on 1.0.0'),
    ).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole('link', { name: /How to fix/ })).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('heads each row with its name and puts the blocks one level below', async () => {
    serve();
    const user = userEvent.setup();
    renderView();
    expect(await screen.findByRole('heading', { level: 3, name: 'EBO Sales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'HR Portal' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Who can open this dashboard' }),
    ).toBeInTheDocument();
    const sales = await openRow(user, 'EBO Sales');
    for (const block of ['Coverage', 'Environments', 'Releases', 'Server']) {
      expect(within(sales).getByRole('heading', { level: 4, name: block })).toBeInTheDocument();
    }
    expect(
      within(sales).getByRole('heading', { level: 4, name: 'SSO cookie (browser identity)' }),
    ).toBeInTheDocument();
    expect(within(sales).queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('narrows to the app of the global filter, opened, with a way back to every app', async () => {
    serve();
    const user = userEvent.setup();
    renderView({ searchParams: '?app=hr-portal' });
    expect(await screen.findByRole('region', { name: 'HR Portal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details for HR Portal' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByRole('button', { name: /details for EBO Sales/ })).toBeNull();
    // The headline counts the one visible app, in the singular.
    expect(await headlineText()).toContain('0 of 1 app healthy');
    expect(await headlineText()).toContain('1 needs attention (apps with warnings).');

    await user.click(screen.getByRole('button', { name: 'Show all apps' }));
    expect(
      await screen.findByRole('button', { name: 'Show details for EBO Sales' }),
    ).toBeInTheDocument();
  });

  it('opens the only app by default', async () => {
    serve({ ...INTEGRATION_HEALTH, apps: [appHealth()] });
    renderView();
    expect(await screen.findByRole('region', { name: 'EBO Sales' })).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows the integration level, coverage, environments, releases, rejections and SSO outcomes', async () => {
    serve();
    const user = userEvent.setup();
    renderView();
    const salesRow = await rowOf('EBO Sales');
    const sales = await openRow(user, 'EBO Sales');

    // Level: the badge (row title) and what the next level needs (details).
    expect(within(salesRow).getAllByText('Connected').length).toBeGreaterThan(0);
    expect(within(sales).getByText(/Fully integrated also needs 80 %/)).toBeInTheDocument();

    const coverage = within(sales).getByRole('region', { name: 'Coverage' });
    expect(
      within(coverage).getByLabelText('95% of server events carry a verified user'),
    ).toBeInTheDocument();
    expect(
      within(coverage).getByLabelText('50% of browser events carry a verified user (low)'),
    ).toBeInTheDocument();
    expect(
      within(coverage).getByLabelText('71% of linkable API calls carry the browser session (low)'),
    ).toBeInTheDocument();
    expect(within(coverage).getByText(/640 with page view/)).toBeInTheDocument();
    // Identity scope is stated: Applications combines both sources, this page splits them.
    expect(
      within(coverage).getByText(/Applications shows identified events for both sources combined/),
    ).toBeInTheDocument();

    const environments = within(sales).getByRole('region', { name: 'Environments' });
    expect(within(environments).getByText('Staging')).toBeInTheDocument();
    expect(within(environments).getAllByText('Production')).toHaveLength(2);

    const releases = within(sales).getByRole('region', { name: 'Releases' });
    expect(within(releases).getByText('2026.10.01-a1b2c3d')).toBeInTheDocument();
    expect(within(releases).getByText('no release sent')).toBeInTheDocument();

    const rejections = within(sales).getByRole('table', { name: 'Rejected events of EBO Sales' });
    expect(within(rejections).getByText('INVALID_EVENT')).toBeInTheDocument();
    expect(within(rejections).getByText('events.*.durationMs')).toBeInTheDocument();

    const sso = within(sales).getByRole('region', { name: 'SSO cookie outcomes of EBO Sales' });
    expect(within(sso).getByText('no-cookie')).toBeInTheDocument();
    expect(within(sso).getByText(/Path, Domain and SameSite/)).toBeInTheDocument();

    // Nothing redacted → no PII table; the HR row has no rejections either.
    expect(within(sales).queryByRole('table', { name: /Personal data redacted/ })).toBeNull();
    const hrRow = await rowOf('HR Portal');
    expect(within(hrRow).getAllByText('Not connected').length).toBeGreaterThan(0);
    const hr = await openRow(user, 'HR Portal');
    expect(within(hr).queryByRole('table', { name: /Rejected events/ })).toBeNull();
  });

  it('flags redacted personal data with its guide chapter and lists where it was found', async () => {
    serve({
      ...INTEGRATION_HEALTH,
      apps: [
        appHealth({
          warnings: ['pii_detected'],
          piiDetections: [{ source: 'browser', field: 'path', kind: 'phone', detections: 7 }],
        }),
      ],
    });
    renderView();
    const sales = await screen.findByRole('region', { name: 'EBO Sales' });
    const warnings = within(sales).getByRole('list', { name: 'Warnings for EBO Sales' });
    expect(within(warnings).getByText('Personal data redacted')).toBeInTheDocument();
    expect(within(warnings).getByRole('link', { name: /How to fix/ })).toHaveAttribute(
      'href',
      '/traffic/api/docs/#05-pii',
    );
    const pii = within(sales).getByRole('table', { name: 'Personal data redacted for EBO Sales' });
    expect(within(pii).getByText('Phone number')).toBeInTheDocument();
    expect(within(pii).getByText('7')).toBeInTheDocument();
  });

  it('states the counts in one headline sentence with every old card hint', async () => {
    serve();
    renderView();
    expect(await headlineText()).toBe(
      '1 of 2 apps healthy (events in the last 24 h). 0 stale (nothing recent), 1 with no events yet (registered, never sent). 2 need attention (apps with warnings). 0 fully integrated (linked, identified, tagged).',
    );
    expect(screen.getByText('2')).toHaveClass('text-warning');
    expect(screen.queryByRole('region', { name: 'Integration status' })).toBeNull();
  });

  it('counts fully integrated apps in the headline, with the level explained', async () => {
    serve({
      ...INTEGRATION_HEALTH,
      apps: [
        appHealth({ level: 'complete', warnings: [] }),
        appHealth({ app: 'hr-portal', displayName: 'HR Portal' }),
      ],
    });
    renderView();
    expect(await headlineText()).toContain('1 fully integrated (linked, identified, tagged).');
    expect(screen.getByRole('button', { name: 'What is Fully integrated?' })).toBeInTheDocument();
  });

  it.each<[DashboardAccess, 'pass' | 'warn' | 'fail', string, RegExp, string | null]>([
    [
      'wholeDomain',
      'fail',
      'Action needed',
      /Anyone with a company email can open this dashboard: no named list of viewers is set \(DASHBOARD_ALLOWED_EMAILS is empty\)\./,
      'Set the named list on the server, then restart api and web',
    ],
    [
      'listed',
      'pass',
      'OK',
      /Only the people on the named list and the admins can open it\./,
      null,
    ],
    ['adminsOnly', 'pass', 'OK', /^Only admins can open it\.$/, null],
    ['unknown', 'warn', 'Needs attention', /Could not read this server's access settings\./, null],
  ])('checks who can open the dashboard (%s)', async (access, state, label, summary, action) => {
    serve();
    renderView({ access });
    const platform = screen.getByRole('region', { name: 'Platform' });
    const row = within(platform)
      .getByText('Who can open this dashboard')
      .closest<HTMLElement>('[data-slot="check-row"]')!;
    expect(row.dataset.state).toBe(state);
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).getByText(summary)).toBeInTheDocument();
    if (action) expect(within(row).getByText(action)).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    // The platform check does not wait for the app list.
    expect(await rowOf('EBO Sales')).toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows the empty state when no app is registered', async () => {
    serve({ ...INTEGRATION_HEALTH, apps: [] });
    renderView();
    expect(await screen.findByText('No apps registered yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open App keys' })).toHaveAttribute('href', '/apps');
  });

  it('shows the error state with the request id', async () => {
    server.use(
      http.get(routeUrl(ROUTES.integration.health), () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom', requestId: 'req-9' } },
          { status: 500 },
        ),
      ),
    );
    renderView();
    expect(await screen.findByText('Could not load the integration status')).toBeInTheDocument();
    expect(screen.getByText(/Request ID req-9/)).toBeInTheDocument();
    // The platform check still shows.
    expect(screen.getByText('Who can open this dashboard')).toBeInTheDocument();
  });
});

describe('integration helpers', () => {
  it('tallies statuses and apps needing attention', () => {
    expect(tallyHealth(INTEGRATION_HEALTH.apps)).toEqual({
      healthy: 1,
      stale: 0,
      never: 1,
      needsAttention: 2,
      complete: 0,
    });
    expect(tallyHealth([appHealth({ warnings: [] })]).needsAttention).toBe(0);
    expect(tallyHealth([appHealth({ level: 'complete' }), appHealth()]).complete).toBe(1);
  });

  it('formats ages and signed skews', () => {
    const now = Date.parse('2026-10-01T10:00:00.000Z');
    expect(formatAgo(null, now)).toBeNull();
    expect(formatAgo('2026-10-01T10:00:00.000Z', now)).toBe('just now');
    expect(formatAgo('2026-10-01T09:59:18.000Z', now)).toBe('42 s ago');
    expect(formatAgo('2026-10-01T08:30:00.000Z', now)).toBe('1 h ago');
    expect(formatAgo('2026-09-28T10:00:00.000Z', now)).toBe('3 d ago');
    expect(formatSkew(120)).toBe('+120 ms');
    expect(formatSkew(-90_000)).toBe('−90.0 s');
    expect(formatSkew(0)).toBe('0 ms');
    expect(formatSkew(null)).toBe('—');
  });
});
