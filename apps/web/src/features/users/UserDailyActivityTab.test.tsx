import {
  ROUTES,
  type TimeWindowQuery,
  type UserDailyActivityDto,
  type UserDayActivityDto,
} from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { USER_DAILY, USER_KEY, userDayApp, userDayFrom } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { aboutTheseNumbersLines } from './AboutTheseNumbers';
import { UserDailyActivityTab } from './UserDailyActivityTab';

const FILTERS: TimeWindowQuery = { range: '7d', app: 'ebo-sales', env: 'staging' };

/**
 * The first fixture day with two apps — vendor-portal (API calls only) used FIRST, at 07:30 IST,
 * so first-use order differs from slug order; the second day without a visit. Both are folded from
 * their app lines (userDayFrom), like the API does.
 */
function days(): UserDayActivityDto[] {
  const [today, yesterday] = USER_DAILY.items;
  if (!today || !yesterday) throw new Error('fixture');
  const vendor = userDayApp('vendor-portal', {
    firstActivityAt: '2026-10-01T02:00:00.000Z',
    lastActivityAt: '2026-10-01T02:30:00.000Z',
    activeMs: 0,
    pageViews: 0,
    requests: 12,
    failedRequests: 0,
    toolUses: 0,
    visits: 0,
  });
  const quiet = { pageViews: 1, toolUses: 1, requests: 1, visits: 0 };
  return [
    userDayFrom(today.day, [...today.perApp, vendor]),
    userDayFrom(
      yesterday.day,
      yesterday.perApp.map((app) => ({ ...app, ...quiet })),
    ),
  ];
}

/** A day with `count` apps (a-app, b-app, …), each with browser time, in that first-use order. */
function dayWithApps(count: number): UserDayActivityDto {
  const [today] = USER_DAILY.items;
  if (!today) throw new Error('fixture');
  const perApp = Array.from({ length: count }, (_, i) =>
    userDayApp(`${String.fromCharCode(97 + i)}-app`, {
      activeMs: (i + 1) * 60_000,
      visits: i === 0 ? 1 : 0,
    }),
  );
  return userDayFrom(today.day, perApp);
}

function serveDaily(items: UserDayActivityDto[]): URLSearchParams[] {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.users.daily), ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      const body: UserDailyActivityDto = { ...USER_DAILY, items };
      return HttpResponse.json(body);
    }),
  );
  return queries;
}

async function renderTab(items: UserDayActivityDto[] = days()) {
  const queries = serveDaily(items);
  renderWithProviders(<UserDailyActivityTab userKey={USER_KEY} filters={FILTERS} />);
  return { queries };
}

describe('UserDailyActivityTab — all days', () => {
  it('names the totals with the neutral labels', async () => {
    await renderTab();
    const totals = screen.getByRole('region', { name: 'Daily activity totals' });
    await within(totals).findByText('4 h');
    for (const label of [
      'Active days',
      'Average first activity',
      'Average last activity',
      'Tab visible time',
    ]) {
      expect(within(totals).getByText(label)).toBeInTheDocument();
    }
    expect(within(totals).getByText('added up over the active days')).toBeInTheDocument();
    expect(screen.queryByText('Days active')).toBeNull();
    expect(screen.queryByText('Total active time')).toBeNull();
    // Time in app is a one-day number: never shown, nor totalled, over many days.
    expect(screen.queryByText(/Time in app/)).toBeNull();
  });

  it('shows each day as facts: apps as chips, pages / features / calls, and the tab visible time', async () => {
    await renderTab();
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    // The day's tab visible time and ebo-sales' own line (the only app with browser time).
    expect(await within(table).findAllByText('3 h 12 min')).toHaveLength(2);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = rows[1] as HTMLElement;
    expect(within(first).getByRole('link', { name: 'ebo-sales' })).toHaveAttribute(
      'href',
      '/applications/ebo-sales?range=7d&env=staging',
    );
    expect(within(first).getByRole('link', { name: 'vendor-portal' })).toBeInTheDocument();
    expect(first).toHaveTextContent('40 page views');
    expect(first).toHaveTextContent('5 feature uses');
    expect(first).toHaveTextContent('912 API calls · 3 failed');
    const second = rows[2] as HTMLElement;
    expect(second).toHaveTextContent('1 page view');
    expect(second).toHaveTextContent('1 feature use');
    expect(second).toHaveTextContent('1 API call');
    expect(second).not.toHaveTextContent('failed');
  });

  it("links each day's visits to the Visits page for this person and that one day", async () => {
    await renderTab();
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    const link = await within(table).findByRole('link', { name: /^4 visits on / });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/journeys?')).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({
      app: 'ebo-sales',
      env: 'staging',
      userKey: USER_KEY,
      range: 'custom',
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-01T18:30:00.000Z',
    });
    // A day with API calls only has no visit to open: plain 0, no link.
    const rows = within(table).getAllByRole('row');
    expect(within(rows[2] as HTMLElement).queryByRole('link', { name: /visits on/ })).toBeNull();
  });

  it('lists one line per app in first-use order: its time and first – last event (IST)', async () => {
    await renderTab();
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    await within(table).findAllByText('no browser time');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const lines = within(row).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual([
      'vendor-portalno browser time07:30–08:00',
      'ebo-sales3 h 12 min09:10–18:40',
    ]);
  });

  it('caps the app lines at three with a "+N more" button that expands in place', async () => {
    const user = userEvent.setup();
    const { queries } = await renderTab([dayWithApps(4)]);
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    const more = await within(table).findByRole('button', { name: '+1 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    for (const app of ['a-app', 'b-app', 'c-app']) {
      expect(within(row).getByRole('link', { name: app })).toBeInTheDocument();
    }
    expect(within(row).queryByRole('link', { name: 'd-app' })).toBeNull();
    await user.click(more);
    expect(within(row).getByRole('link', { name: 'd-app' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Local state only: expanding sends no read.
    expect(queries).toHaveLength(1);
    expect(within(row).getByRole('link', { name: /^1 visit on / })).toBeInTheDocument();
  });

  it('shows no "+N more" when a day has three apps or fewer', async () => {
    await renderTab([dayWithApps(3)]);
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    await within(table).findByRole('link', { name: 'c-app' });
    expect(within(table).queryByRole('button', { name: /more/ })).toBeNull();
  });

  it('charts the tab visible time per day over the range, and hides the chart without days', async () => {
    await renderTab();
    expect(
      await screen.findByRole('heading', { name: 'Tab visible time per day' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Tab visible time per day' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'How long app pages were on screen in a front browser tab, per day (India time).',
      ),
    ).toBeInTheDocument();
  });

  it('ends the list visibly and states the limits of the numbers under it', async () => {
    await renderTab();
    expect(await screen.findByText('End of list · 2 days')).toBeInTheDocument();
    const about = screen.getByRole('heading', { name: 'About these numbers' });
    const panel = about.closest('[data-slot="card"]') ?? document.body;
    for (const line of aboutTheseNumbersLines('days')) {
      expect(within(panel as HTMLElement).getByText(line)).toBeInTheDocument();
    }
    expect(panel).toHaveTextContent(/not keyboard or mouse use/);
    expect(panel).toHaveTextContent(/shared/);
  });

  it('shows the empty state without an end marker when the range has no activity', async () => {
    await renderTab([]);
    expect(await screen.findByText('No activity in this range')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show the last/ })).toBeInTheDocument();
    expect(screen.queryByText(/End of list/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tab visible time per day' })).toBeNull();
    // The caveats stay: they are about the view, not about rows.
    expect(screen.getByRole('heading', { name: 'About these numbers' })).toBeInTheDocument();
  });

  it('sends the global range, app and environment to the daily read', async () => {
    const { queries } = await renderTab();
    await screen.findByText('End of list · 2 days');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.get('range')).toBe('7d');
    expect(queries[0]?.get('app')).toBe('ebo-sales');
    expect(queries[0]?.get('env')).toBe('staging');
  });
});

describe('AboutTheseNumbers', () => {
  it('adds the time-in-app line only to the one-day view', () => {
    const days = aboutTheseNumbersLines('days');
    const day = aboutTheseNumbersLines('day');
    expect(day.slice(0, days.length)).toEqual(days);
    expect(day.length).toBeGreaterThan(days.length);
    expect(days.join(' ')).not.toMatch(/Time in app/);
  });
});
