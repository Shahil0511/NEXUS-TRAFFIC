import {
  addReportingDays,
  ROUTES,
  USER_DAY_LOOKBACK_DAYS,
  type MeDto,
  type TimeWindowQuery,
  type UserActivityPatternDto,
  type UserDailyActivityDto,
  type UserDayActivityDto,
  type UserDayDetailDto,
} from '@nexus/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_USER_DAY,
  EMPTY_USER_PATTERN,
  USER_DAILY,
  USER_DAY_DETAIL,
  USER_KEY,
  USER_PATTERN,
  userDayApp,
  userDayFrom,
} from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { aboutTheseNumbersLines } from './AboutTheseNumbers';
import { UserDailyActivityTab } from './UserDailyActivityTab';
import { USUAL_ACTIVITY_HOURS_FOOTNOTE } from './UsualActivityHoursPanel';

/**
 * The switch of the usual-activity-hours panel, mocked so both states are tested; it starts (and is
 * reset to) OFF, the shipped value, so every other test here sees the page as shipped.
 */
const flags = vi.hoisted(() => ({ usualActivityHours: false }));
vi.mock('@/lib/featureFlags', () => ({
  get USUAL_ACTIVITY_HOURS_ENABLED() {
    return flags.usualActivityHours;
  },
}));

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

  it('links each date to the one-day view of that day, keeping the filters', async () => {
    await renderTab();
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    const link = await within(table).findByRole('link', { name: /^Thu, 1 Oct,? 2026$/ });
    const [path, search] = (link.getAttribute('href') ?? '').split('?');
    expect(path).toBe(`/users/${USER_KEY}`);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      app: 'ebo-sales',
      range: '7d',
      env: 'staging',
      tab: 'daily',
      day: '2026-10-01',
    });
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

  it('states the credit cap of one stretch without a tick on both views (ADR 0017)', () => {
    const cap =
      'One stretch without a tick (for example a sleeping laptop) counts at most 1 minute.';
    expect(aboutTheseNumbersLines('days')).toContain(cap);
    expect(aboutTheseNumbersLines('day')).toContain(cap);
  });
});

describe('UserDailyActivityTab — the table fits its container', () => {
  it('is a fixed-layout table with wrapping cells, fixed column widths and a Visits column', async () => {
    await renderTab([dayWithApps(4)]);
    const table = await screen.findByRole('table', { name: 'Daily activity' });
    await within(table).findByRole('link', { name: 'a-app' });
    // Its width is the container's, never its content's; below the min width it scrolls in place.
    expect(table).toHaveClass('table-fixed', 'w-full', 'min-w-[54rem]');
    expect(table.parentElement).toHaveClass('overflow-x-auto');

    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      'Date',
      'First – last activity (IST)',
      'Tab visible time',
      'Apps',
      'Pages and calls',
      'Visits',
    ]);
    for (const header of headers) {
      expect(header).toHaveClass('whitespace-normal');
      // A full-width or min-width column made the auto table wider than the page.
      expect(header.className).not.toMatch(/\bw-full\b|\bmin-w-/);
    }
    const [date, span, tabVisible, apps, counts, visits] = headers as HTMLElement[];
    for (const fixed of [date, span, tabVisible, counts, visits]) {
      expect(fixed?.className).toMatch(/\bw-\d+\b/);
    }
    // Apps has no width: it takes what is left, and its lines wrap instead of widening it.
    expect(apps?.className).not.toMatch(/\bw-/);

    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    for (const cell of within(row).getAllByRole('cell')) {
      expect(cell).toHaveClass('whitespace-normal');
    }
    const lines = row.querySelectorAll('[data-slot="day-app-line"]');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toHaveClass('flex-wrap', 'min-w-0');
      expect(line).not.toHaveClass('whitespace-nowrap');
    }
    expect(within(row).getByRole('button', { name: '+1 more' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^1 visit on / })).toBeInTheDocument();
  });

  it('keeps an empty range at the panel width so its message and action stay in view', async () => {
    await renderTab([]);
    expect(await screen.findByText('No activity in this range')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Daily activity' });
    expect(table).toHaveClass('table-fixed', 'w-full');
    expect(table).not.toHaveClass('min-w-[54rem]');
    expect(within(table).getByRole('button', { name: /Show the last/ })).toBeInTheDocument();
  });
});

// ─── One-day view (?tab=daily&day=YYYY-MM-DD) ───────────────────────────────

/** 15:30 IST on 1 Oct 2026: the fixture day is today. */
const NOW = new Date('2026-10-01T10:00:00.000Z');
const DAY = '2026-10-01';

function serveDay(body: UserDayDetailDto = USER_DAY_DETAIL): URLSearchParams[] {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.users.day), ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
  return queries;
}

async function renderDay(
  day: string = DAY,
  body: UserDayDetailDto = USER_DAY_DETAIL,
  onUrlUpdate?: (event: UrlUpdateEvent) => void,
) {
  const queries = serveDay({ ...body, day });
  renderWithProviders(<UserDailyActivityTab userKey={USER_KEY} filters={FILTERS} />, {
    searchParams: `?tab=daily&day=${day}`,
    onUrlUpdate,
  });
  return { queries };
}

describe('UserDailyActivityTab — one day', () => {
  beforeEach(() => {
    // Only Date is faked: React Query and MSW keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads that one day with the app and env, never the global range', async () => {
    const { queries } = await renderDay();
    await screen.findByRole('region', { name: 'This day' });
    expect(queries).toHaveLength(1);
    expect(Object.fromEntries(queries[0] ?? [])).toEqual({
      day: DAY,
      app: 'ebo-sales',
      env: 'staging',
    });
    expect(screen.queryByRole('table', { name: 'Daily activity' })).toBeNull();
  });

  it('titles the day in India time and shows the five KPIs', async () => {
    await renderDay();
    expect(
      await screen.findByRole('heading', { name: /^Thu, 1 Oct,? 2026 \(India time\)$/ }),
    ).toBeInTheDocument();
    const kpis = await screen.findByRole('region', { name: 'This day' });
    const card = (label: string) =>
      within(kpis).getByText(label).closest('[data-slot="card"]') as HTMLElement;
    expect(card('First activity')).toHaveTextContent('07:30 IST');
    expect(card('Last activity')).toHaveTextContent('18:40 IST');
    expect(card('Time in app')).toHaveTextContent('3 h');
    expect(card('Time in app')).toHaveTextContent('Tab visible time 3 h 22 min');
    expect(card('Apps')).toHaveTextContent('2');
    expect(card('Visits')).toHaveTextContent('5');
    expect(
      screen.getByText('This view shows one whole day; the range picker above does not change it.'),
    ).toBeInTheDocument();
  });

  it('lists the activity blocks as text under the decorative timeline', async () => {
    await renderDay();
    const table = await screen.findByRole('table', { name: 'Activity blocks' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Start',
      'End',
      'Length',
      'Time in app',
      'Tab visible time',
      'Apps',
      'Page views',
      'Feature uses',
      'API calls',
    ]);
    expect(rows[1]).toHaveTextContent(/07:30.*08:00.*30 min/);
    expect(rows[2]).toHaveTextContent(/09:10.*18:40.*9 h 30 min.*2 h 50 min.*3 h 12 min/);
    const timeline = document.querySelector('[data-slot="day-timeline"]');
    expect(timeline).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByTestId('day-timeline-segment')).toHaveLength(2);
    // From METRIC_COPY, with its explanation one tap away.
    expect(screen.getByText('API calls outside these blocks:')).toHaveTextContent(
      'API calls outside these blocks: 50',
    );
    expect(
      screen.getByRole('button', { name: 'What is API calls outside these blocks?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
    // It is a fixed-layout table that fits its container.
    expect(table).toHaveClass('table-fixed', 'w-full');
  });

  it('shows the truncation line when the day has more blocks than listed; the end marker counts them all', async () => {
    await renderDay(DAY, { ...USER_DAY_DETAIL, blockCount: 120, blocksTruncated: true });
    expect(await screen.findByText('Showing the first 2 blocks of the day.')).toBeInTheDocument();
    expect(screen.getByText('End of day · 120 blocks · 5 visits')).toBeInTheDocument();
  });

  it('names India time in every clock column of the apps, pages and features tables', async () => {
    await renderDay();
    const headers = (name: string) =>
      within(screen.getByRole('table', { name }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent);
    await screen.findByRole('table', { name: 'Apps on this day' });
    expect(headers('Apps on this day')).toContain('First – last activity (IST)');
    expect(headers('Pages')).toContain('First view (IST)');
    expect(headers('Feature uses')).toContain('First use (IST)');
  });

  it('lets the pages / features pair shrink below xl so their tables scroll inside the panel', async () => {
    await renderDay();
    await screen.findByRole('table', { name: 'Pages' });
    // grid-cols-1 is minmax(0, 1fr): without it the implicit auto track takes the tables' min width.
    expect(document.querySelector('[data-slot="day-pages-features"]')).toHaveClass(
      'grid',
      'grid-cols-1',
      'xl:grid-cols-2',
    );
  });

  it('lists apps, pages and features in first-use order, with "+N more"', async () => {
    await renderDay();
    const apps = await screen.findByRole('table', { name: 'Apps on this day' });
    const appRows = within(apps).getAllByRole('row').slice(1);
    expect(appRows.map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual([
      'hr-portal',
      'ebo-sales',
    ]);
    expect(appRows[1]).toHaveTextContent('900 · 3 failed');
    const pages = screen.getByRole('table', { name: 'Pages' });
    expect(
      within(pages)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('link')[1]?.textContent),
    ).toEqual(['/leaves', '/stores/:id']);
    expect(screen.getByText('+30 more pages on this day')).toBeInTheDocument();
    const tools = screen.getByRole('table', { name: 'Feature uses' });
    expect(within(tools).getByRole('link', { name: 'export-csv' })).toBeInTheDocument();
    expect(screen.queryByText(/more features on this day/)).toBeNull();
  });

  it('opens each visit\'s steps over this day (custom range) and continues "+N more" on Visits', async () => {
    await renderDay();
    const table = await screen.findByRole('table', { name: 'Visits on this day' });
    const steps = within(table).getAllByRole('link', { name: /^Visit steps/ });
    expect(steps).toHaveLength(2);
    const [path, search] = (steps[0]?.getAttribute('href') ?? '').split('?');
    expect(path).toBe(`/journeys/ebo-sales/${USER_DAY_DETAIL.visits[0]?.sessionId}`);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      range: 'custom',
      from: USER_DAY_DETAIL.window.from,
      to: USER_DAY_DETAIL.window.to,
      app: 'ebo-sales',
      env: 'staging',
    });
    const more = screen.getByRole('link', { name: '+3 more visits on this day' });
    const query = new URLSearchParams(more.getAttribute('href')?.split('?')[1]);
    expect(Object.fromEntries(query)).toMatchObject({
      userKey: USER_KEY,
      range: 'custom',
      from: USER_DAY_DETAIL.window.from,
      to: USER_DAY_DETAIL.window.to,
    });
    expect(screen.getByText('End of day · 2 blocks · 5 visits')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About these numbers' })).toBeInTheDocument();
  });

  it('disables Next day and Today on today; Previous day moves one day back in the URL', async () => {
    const user = userEvent.setup();
    const updates: string[] = [];
    await renderDay(DAY, USER_DAY_DETAIL, (event) => updates.push(event.queryString));
    await screen.findByRole('region', { name: 'This day' });
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
    const previous = screen.getByRole('button', { name: 'Previous day' });
    expect(previous).toBeEnabled();
    await user.click(previous);
    await waitFor(() => expect(updates.at(-1)).toContain('day=2026-09-30'));
    expect(updates.at(-1)).toContain('tab=daily');
  });

  it('disables Previous day at the lookback limit', async () => {
    const oldest = addReportingDays(DAY, -USER_DAY_LOOKBACK_DAYS);
    await renderDay(oldest);
    await screen.findByRole('region', { name: 'This day' });
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    expect(screen.getByLabelText('Day to show')).toHaveAttribute('min', oldest);
    expect(screen.getByLabelText('Day to show')).toHaveAttribute('max', DAY);
  });

  it('opens a typed day only on Enter or "Show day", never an in-between or out-of-range value', async () => {
    const updates: string[] = [];
    await renderDay(DAY, USER_DAY_DETAIL, (event) => updates.push(event.queryString));
    await screen.findByRole('region', { name: 'This day' });
    const input = screen.getByLabelText('Day to show');
    const show = screen.getByRole('button', { name: 'Show day' });
    expect(show).toBeDisabled();
    // Typing a month digit by digit gives an out-of-range day first: kept as typed, nothing opens.
    fireEvent.change(input, { target: { value: '2026-01-15' } });
    expect(input).toHaveValue('2026-01-15');
    expect(show).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    // An in-range step does not open on its own either.
    fireEvent.change(input, { target: { value: '2026-09-20' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(updates).toEqual([]);
    expect(show).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updates.at(-1)).toContain('day=2026-09-20'));
    expect(updates.at(-1)).toContain('tab=daily');
  });

  it('"Show day" opens the picked day', async () => {
    const user = userEvent.setup();
    const updates: string[] = [];
    await renderDay(DAY, USER_DAY_DETAIL, (event) => updates.push(event.queryString));
    await screen.findByRole('region', { name: 'This day' });
    fireEvent.change(screen.getByLabelText('Day to show'), { target: { value: '2026-09-15' } });
    await user.click(screen.getByRole('button', { name: 'Show day' }));
    await waitFor(() => expect(updates.at(-1)).toContain('day=2026-09-15'));
  });

  it('a future day in the URL sends no read, says which days open, and "Show today" goes to today', async () => {
    const user = userEvent.setup();
    const updates: string[] = [];
    const { queries } = await renderDay('2026-10-05', USER_DAY_DETAIL, (event) =>
      updates.push(event.queryString),
    );
    expect(await screen.findByText('This day cannot be shown')).toBeInTheDocument();
    const oldest = addReportingDays(DAY, -USER_DAY_LOOKBACK_DAYS);
    expect(screen.getByText(/^Pick a day from .+ to today\.$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Day to show')).toHaveAttribute('min', oldest);
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'About these numbers' })).toBeInTheDocument();
    expect(queries).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Show today' }));
    await waitFor(() => expect(updates.at(-1)).toContain(`day=${DAY}`));
  });

  it('a day older than the lookback sends no read; Next day goes to the oldest day', async () => {
    const user = userEvent.setup();
    const updates: string[] = [];
    const tooOld = addReportingDays(DAY, -USER_DAY_LOOKBACK_DAYS - 10);
    const { queries } = await renderDay(tooOld, USER_DAY_DETAIL, (event) =>
      updates.push(event.queryString),
    );
    expect(await screen.findByText('This day cannot be shown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    expect(queries).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    const oldest = addReportingDays(DAY, -USER_DAY_LOOKBACK_DAYS);
    await waitFor(() => expect(updates.at(-1)).toContain(`day=${oldest}`));
  });

  it('"All days" goes back to the list of days (day removed from the URL)', async () => {
    const user = userEvent.setup();
    const updates: string[] = [];
    await renderDay(DAY, USER_DAY_DETAIL, (event) => updates.push(event.queryString));
    serveDaily(days());
    await screen.findByRole('region', { name: 'This day' });
    await user.click(screen.getByRole('button', { name: 'All days' }));
    await waitFor(() => expect(updates.at(-1)).not.toContain('day='));
    expect(updates.at(-1)).toContain('tab=daily');
    expect(await screen.findByRole('table', { name: 'Daily activity' })).toBeInTheDocument();
  });

  it('an empty day says so and keeps Previous working; the caveats stay', async () => {
    await renderDay('2026-09-28', EMPTY_USER_DAY);
    expect(await screen.findByText('No activity on this day')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'This day' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'About these numbers' })).toBeInTheDocument();
  });

  it('an invalid day in the URL falls back to all days', async () => {
    serveDaily(days());
    const { queries } = { queries: serveDay() };
    renderWithProviders(<UserDailyActivityTab userKey={USER_KEY} filters={FILTERS} />, {
      searchParams: '?tab=daily&day=2026-02-30',
    });
    expect(await screen.findByRole('table', { name: 'Daily activity' })).toBeInTheDocument();
    expect(queries).toEqual([]);
  });

  it('sends no read for a viewer who is not an admin', async () => {
    const notAdmin: MeDto = { email: 'viewer@libas.in', isAdmin: false };
    let meCalls = 0;
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => {
        meCalls += 1;
        return HttpResponse.json(notAdmin);
      }),
    );
    const { queries } = await renderDay();
    await waitFor(() => expect(meCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queries).toEqual([]);
  });
});

describe('UserDailyActivityTab — usual activity hours', () => {
  afterEach(() => {
    flags.usualActivityHours = false;
  });

  function servePattern(body: UserActivityPatternDto = USER_PATTERN): URLSearchParams[] {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.users.pattern), ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json(body);
      }),
    );
    return queries;
  }

  it('ships switched off: no panel and no pattern request', async () => {
    const shipped =
      await vi.importActual<typeof import('@/lib/featureFlags')>('@/lib/featureFlags');
    expect(shipped.USUAL_ACTIVITY_HOURS_ENABLED).toBe(false);
    const queries = servePattern();
    await renderTab();
    await screen.findByText('End of list · 2 days');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('heading', { name: 'Usual activity hours' })).toBeNull();
    expect(screen.queryByText(USUAL_ACTIVITY_HOURS_FOOTNOTE)).toBeNull();
    expect(queries).toEqual([]);
  });

  it('switched on: asks for the last 30 days with app and env, only after the daily read succeeded', async () => {
    flags.usualActivityHours = true;
    const queries = servePattern();
    let release: () => void = () => undefined;
    const dailyHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(routeUrl(ROUTES.users.daily), async () => {
        await dailyHeld;
        return HttpResponse.json({ ...USER_DAILY, items: days() });
      }),
    );
    renderWithProviders(<UserDailyActivityTab userKey={USER_KEY} filters={FILTERS} />);
    expect(
      await screen.findByRole('heading', { name: 'Usual activity hours' }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queries).toEqual([]);
    release();
    await screen.findByText('End of list · 2 days');
    await waitFor(() => expect(queries).toHaveLength(1));
    expect(Object.fromEntries(queries[0] ?? [])).toEqual({
      range: '30d',
      app: 'ebo-sales',
      env: 'staging',
    });
  });

  it('switched on: draws the 7 × 24 grid with a sentence per cell, a legend and the footnote', async () => {
    flags.usualActivityHours = true;
    servePattern();
    await renderTab();
    const panel = await screen.findByRole('region', { name: 'Usual activity hours' });
    await within(panel).findByText(
      '9 active days over today and the 30 days before it (whole days, India time).',
    );
    const cells = within(panel).getAllByTestId('hour-grid-cell');
    expect(cells).toHaveLength(7 * 24);
    const sentence =
      'Tuesday 10:00–11:00: activity on 4 of 5 Tuesdays, 2 h 10 min tab visible time';
    expect(cells[24 + 10]).toHaveAttribute('aria-label', sentence);
    expect(cells[24 + 10]).toHaveAttribute('title', sentence);
    expect(cells[0]).toHaveAttribute('aria-label', 'Monday 00:00–01:00: no activity on 4 Mondays');
    // Decorative for screen readers: the hidden table carries the text.
    expect(panel.querySelector('[data-slot="hour-grid"]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(panel).getByText(/Share of those weekdays with activity/)).toBeInTheDocument();
    expect(within(panel).getByText(USUAL_ACTIVITY_HOURS_FOOTNOTE)).toBeInTheDocument();
  });

  it('switched on: the hidden table has a caption, weekday row headers and hour column headers', async () => {
    flags.usualActivityHours = true;
    servePattern();
    await renderTab();
    const table = await screen.findByRole('table', { name: /^Usual activity hours, India time/ });
    // Hidden by a block wrapper: a table box ignores width 1px and could widen the page.
    expect(table).not.toHaveClass('sr-only');
    expect(table.parentElement).toHaveClass('sr-only');
    const columns = within(table).getAllByRole('columnheader');
    expect(columns).toHaveLength(25);
    expect(columns[0]).toHaveTextContent('Weekday');
    expect(columns[11]).toHaveTextContent('10:00–11:00');
    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.map((header) => header.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    const tuesday = within(table).getAllByRole('row')[2] as HTMLElement;
    expect(within(tuesday).getAllByRole('cell')[10]).toHaveTextContent('4 of 5, 2 h 10 min');
  });

  it('switched on: "Last 7 days" asks for 7d; the global range never reaches the read', async () => {
    flags.usualActivityHours = true;
    const queries = servePattern();
    await renderTab();
    const panel = await screen.findByRole('region', { name: 'Usual activity hours' });
    await waitFor(() => expect(queries).toHaveLength(1));
    expect(within(panel).getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(panel).getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() => expect(queries).toHaveLength(2));
    expect(queries.map((query) => query.get('range'))).toEqual(['30d', '7d']);
    // The 7-day window is 8 whole India-time days: the summary says so.
    await within(panel).findByText(
      '9 active days over today and the 7 days before it (whole days, India time).',
    );
    for (const query of queries) {
      expect(query.has('from')).toBe(false);
      expect(query.has('to')).toBe(false);
    }
  });

  it('switched on: an empty range says so', async () => {
    flags.usualActivityHours = true;
    servePattern(EMPTY_USER_PATTERN);
    await renderTab();
    expect(await screen.findByText('No activity in the last 30 days')).toBeInTheDocument();
    expect(screen.queryAllByTestId('hour-grid-cell')).toEqual([]);
  });

  it('switched on: sends no pattern read for a viewer who is not an admin', async () => {
    flags.usualActivityHours = true;
    const queries = servePattern();
    let meCalls = 0;
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => {
        meCalls += 1;
        const viewer: MeDto = { email: 'viewer@libas.in', isAdmin: false };
        return HttpResponse.json(viewer);
      }),
    );
    await renderTab();
    await screen.findByText('End of list · 2 days');
    await waitFor(() => expect(meCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queries).toEqual([]);
  });
});
