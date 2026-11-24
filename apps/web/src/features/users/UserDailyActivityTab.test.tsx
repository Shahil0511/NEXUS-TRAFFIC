import {
  ROUTES,
  type TimeWindowQuery,
  type UserDailyActivityDto,
  type UserDayActivityDto,
} from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { USER_DAILY, USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { aboutTheseNumbersLines } from './AboutTheseNumbers';
import { UserDailyActivityTab } from './UserDailyActivityTab';

const FILTERS: TimeWindowQuery = { range: '7d', app: 'ebo-sales', env: 'staging' };

/** The first fixture day with two apps; the second with API calls only (no visit). */
function days(): UserDayActivityDto[] {
  const [today, yesterday] = USER_DAILY.items;
  if (!today || !yesterday) throw new Error('fixture');
  return [
    { ...today, apps: ['ebo-sales', 'vendor-portal'] },
    { ...yesterday, pageViews: 1, toolUses: 1, requests: 1, visits: 0 },
  ];
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
    await within(table).findByText('3 h 12 min');
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
    expect(first).toHaveTextContent('900 API calls · 3 failed');
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

  it('caps the app chips at three with a "+N" that names the rest, and reads one visit as "visit"', async () => {
    const [today] = days();
    if (!today) throw new Error('fixture');
    await renderTab([{ ...today, apps: ['a-app', 'b-app', 'c-app', 'd-app'], visits: 1 }]);
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    const more = await within(table).findByText('+1');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    for (const app of ['a-app', 'b-app', 'c-app']) {
      expect(within(row).getByRole('link', { name: app })).toBeInTheDocument();
    }
    expect(within(row).queryByRole('link', { name: 'd-app' })).toBeNull();
    expect(more).toHaveTextContent('more: d-app');
    expect(within(row).getByRole('link', { name: /^1 visit on / })).toBeInTheDocument();
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
