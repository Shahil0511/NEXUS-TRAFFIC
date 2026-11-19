import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { appHealth, INTEGRATION_HEALTH } from '@/test/adminFixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { formatAgo, formatSkew } from './integrationCopy';
import { IntegrationView, tallyHealth } from './IntegrationView';

function serve(body = INTEGRATION_HEALTH) {
  server.use(http.get(routeUrl(ROUTES.integration.health), () => HttpResponse.json(body)));
}

describe('IntegrationView', () => {
  it('renders one card per app with status, warnings, counters, SDKs and guide links', async () => {
    serve();
    renderWithProviders(<IntegrationView />);

    const sales = await screen.findByRole('region', { name: 'EBO Sales' });
    expect(within(sales).getByText('Healthy')).toBeInTheDocument();

    const warnings = within(sales).getByRole('list', { name: 'Warnings for EBO Sales' });
    expect(within(warnings).getByText('Secret key exposed')).toBeInTheDocument();
    expect(within(warnings).getByText('Proxy IPs instead of users')).toBeInTheDocument();
    // The proxy-IP warning says what it costs on the dashboard, not only how to fix it.
    expect(within(warnings).getByText(/Geography and location stay empty/)).toBeInTheDocument();
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

    const hr = screen.getByRole('region', { name: 'HR Portal' });
    expect(within(hr).getByText('No events yet')).toBeInTheDocument();
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
  });

  it('narrows to the app of the global filter, with a way back to every app', async () => {
    serve();
    const user = userEvent.setup();
    renderWithProviders(<IntegrationView />, { searchParams: '?app=hr-portal' });
    expect(await screen.findByRole('region', { name: 'HR Portal' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'EBO Sales' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all apps' }));
    expect(await screen.findByRole('region', { name: 'EBO Sales' })).toBeInTheDocument();
  });

  it('shows the integration level, coverage, environments, releases, rejections and SSO outcomes', async () => {
    serve();
    renderWithProviders(<IntegrationView />);
    const sales = await screen.findByRole('region', { name: 'EBO Sales' });

    // Level: the badge and what the next level needs.
    expect(within(sales).getAllByText('Connected').length).toBeGreaterThan(0);
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

    // Nothing redacted → no PII table; the HR card has no rejections either.
    expect(within(sales).queryByRole('table', { name: /Personal data redacted/ })).toBeNull();
    const hr = screen.getByRole('region', { name: 'HR Portal' });
    expect(within(hr).getAllByText('Not connected').length).toBeGreaterThan(0);
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
    renderWithProviders(<IntegrationView />);
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

  it('counts fully integrated apps in the headline', async () => {
    serve({
      ...INTEGRATION_HEALTH,
      apps: [
        appHealth({ level: 'complete', warnings: [] }),
        appHealth({ app: 'hr-portal', displayName: 'HR Portal' }),
      ],
    });
    renderWithProviders(<IntegrationView />);
    const status = await screen.findByRole('region', { name: 'Integration status' });
    const kpi = (await within(status).findByText('Fully integrated')).closest<HTMLElement>(
      '[aria-busy]',
    );
    // One of the two apps is complete (Healthy reads 2, so the 1 is this KPI's own value).
    expect(within(kpi!).getByText('1')).toBeInTheDocument();
    expect(
      within(status).getByRole('button', { name: 'What is Fully integrated?' }),
    ).toBeInTheDocument();
  });

  it('shows the empty state when no app is registered', async () => {
    serve({ ...INTEGRATION_HEALTH, apps: [] });
    renderWithProviders(<IntegrationView />);
    expect(await screen.findByText('No apps registered yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Apps' })).toHaveAttribute('href', '/apps');
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
    renderWithProviders(<IntegrationView />);
    expect(await screen.findByText('Could not load the integration status')).toBeInTheDocument();
    expect(screen.getByText(/Request ID req-9/)).toBeInTheDocument();
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
