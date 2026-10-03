import { ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
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
    expect(within(sdks).getByText('@nexus/express@1.0.0')).toBeInTheDocument();
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

  it('narrows to the app of the global filter', async () => {
    serve();
    renderWithProviders(<IntegrationView />, { searchParams: '?app=hr-portal' });
    expect(await screen.findByRole('region', { name: 'HR Portal' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'EBO Sales' })).not.toBeInTheDocument();
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
    });
    expect(tallyHealth([appHealth({ warnings: [] })]).needsAttention).toBe(0);
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
