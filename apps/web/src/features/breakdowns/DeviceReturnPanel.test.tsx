import { ROUTES } from '@nexus/shared';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEVICE_RETURN } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { DeviceReturnPanel, returningPct } from './DeviceReturnPanel';

describe('DeviceReturnPanel', () => {
  it('shows devices split into new and returning, each explained', async () => {
    server.use(http.get(routeUrl(ROUTES.overview.devices), () => HttpResponse.json(DEVICE_RETURN)));
    renderWithProviders(<DeviceReturnPanel filters={{ range: '7d' }} />);
    expect(await screen.findByText('200')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText(/of devices came back/)).toHaveTextContent('75%');
    expect(screen.getByText('Returning = also seen in the 30 days before')).toBeInTheDocument();
    for (const label of ['Devices', 'New', 'Returning']) {
      expect(screen.getByRole('button', { name: `What is ${label}?` })).toBeInTheDocument();
    }
  });

  it('shows the empty state without devices', async () => {
    server.use(
      http.get(routeUrl(ROUTES.overview.devices), () =>
        HttpResponse.json({ ...DEVICE_RETURN, devices: 0, newDevices: 0, returningDevices: 0 }),
      ),
    );
    renderWithProviders(<DeviceReturnPanel filters={{ range: '7d' }} />);
    expect(await screen.findByText('No devices in this window')).toBeInTheDocument();
  });
});

describe('returningPct', () => {
  it('is the returning share in percent, null without devices', () => {
    expect(returningPct(DEVICE_RETURN)).toBe(75);
    expect(returningPct({ ...DEVICE_RETURN, devices: 0, returningDevices: 0 })).toBeNull();
  });
});
