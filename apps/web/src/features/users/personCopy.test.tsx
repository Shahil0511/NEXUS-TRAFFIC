/**
 * WHY: the person pages show plain facts about one person's days, never a judgement of the person
 * (decision 2c, ADR 0017). This test renders every person-level screen that exists from fixtures
 * and scans what a reader can meet — text, aria-labels, titles, alt text, placeholders — for the
 * banned words (NEUTRAL_COPY_BANNED). It scans RENDERED text, so component and icon names
 * (`RankedList`, `MonitorSmartphone`) give no false hits.
 *
 * @see ../../lib/neutralCopy.ts
 */
import {
  ERROR_CODES,
  PERSON_ACCESS_SURFACE_VALUES,
  ROUTES,
  type CursorPage,
  type MeDto,
  type OnlineNowDto,
  type PersonAccessEntryDto,
} from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { SessionDetailView } from '@/features/journeys/SessionDetailView';
import { PrivacyView } from '@/features/privacy/PrivacyView';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import {
  APPS,
  ME,
  SESSION_DETAIL,
  SESSION_ID,
  timelineItem,
  USER_DAILY,
  userDayApp,
  userDayFrom,
  USER_DEVICES,
  USER_KEY,
  USER_PROFILE,
} from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { UserDetailView } from './UserDetailView';

const NOBODY_ONLINE: OnlineNowDto = {
  asOf: '2026-10-01T08:00:00.000Z',
  windowMs: 300_000,
  apps: [],
  users: [],
};

const NOT_ADMIN: MeDto = { email: 'viewer@libas.in', isAdmin: false };

function servePersonReads(me: MeDto = ME): void {
  server.use(
    http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(me)),
    http.get(routeUrl(ROUTES.apps.list), () => HttpResponse.json(APPS)),
    http.get(routeUrl(ROUTES.live.online), () => HttpResponse.json(NOBODY_ONLINE)),
    http.get(routeUrl(ROUTES.users.profile), () => HttpResponse.json(USER_PROFILE)),
    http.get(routeUrl(ROUTES.users.devices), () => HttpResponse.json(USER_DEVICES)),
    http.get(routeUrl(ROUTES.users.daily), () =>
      HttpResponse.json({
        ...USER_DAILY,
        items: USER_DAILY.items.map((day, index) =>
          index === 0
            ? userDayFrom(day.day, [
                ...day.perApp,
                userDayApp('vendor-portal', { activeMs: 0, pageViews: 0, visits: 0 }),
              ])
            : day,
        ),
      }),
    ),
    http.get(routeUrl(ROUTES.users.timeline), () =>
      HttpResponse.json({
        items: [
          timelineItem('t-api', 'api', { path: '/api/orders/123', ip: '203.0.113.7' }),
          timelineItem('t-page', 'page_view'),
          timelineItem('t-tool', 'tool_use', { sessionId: null }),
        ],
        nextCursor: null,
      }),
    ),
  );
}

function serveAccessLog(): void {
  const entries: PersonAccessEntryDto[] = PERSON_ACCESS_SURFACE_VALUES.map((surface, index) => ({
    id: index + 1,
    viewedAt: '2026-10-01T08:00:00.000Z',
    viewerEmail: 'boss@libas.in',
    subjectUserKey: USER_KEY,
    subjectEmailMasked: 'b***@libas.in',
    surface,
  }));
  server.use(
    http.get(routeUrl(ROUTES.privacy.accessLog), () => {
      const page: CursorPage<PersonAccessEntryDto> = { items: entries, nextCursor: null };
      return HttpResponse.json(page);
    }),
  );
}

/** The banned words anywhere a reader can meet text on the current screen. */
function bannedOnScreen(): string[] {
  return findBannedWords(collectRenderedText(document.body));
}

describe('person pages use neutral words only (ADR 0017)', () => {
  it('the Summary tab and the identity card', async () => {
    servePersonReads();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    await screen.findByRole('region', { name: 'User metrics' });
    const card = screen.getByRole('complementary', { name: 'About this person' });
    await within(card).findByRole('region', { name: 'Latest known' });
    expect(within(card).getByText('First activity')).toBeInTheDocument();
    expect(within(card).getByText('Last activity')).toBeInTheDocument();
    expect(within(card).queryByText(/First seen|Last seen/)).toBeNull();
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the Daily activity tab, with its end marker and caveats', async () => {
    servePersonReads();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=daily' });
    await screen.findByText('End of list · 2 days');
    expect(screen.getByRole('heading', { name: 'About these numbers' })).toBeInTheDocument();
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the Devices tab', async () => {
    servePersonReads();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=devices' });
    const table = await screen.findByRole('table', { name: 'Devices' });
    await within(table).findByText('Chrome 126');
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the Activity tab', async () => {
    servePersonReads();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />, { searchParams: '?tab=activity' });
    const table = await screen.findByRole('table', { name: 'User activity' });
    await within(table).findByText('/api/orders/123');
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the admins-only state a viewer sees', async () => {
    servePersonReads(NOT_ADMIN);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    await screen.findByRole('heading', { name: "Only admins can open a person's page" });
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the visit page and its Visit steps', async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () => HttpResponse.json(SESSION_DETAIL)),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />);
    await screen.findByRole('list', { name: 'Visit steps' });
    await screen.findByRole('link', { name: /person page/i });
    expect(bannedOnScreen()).toEqual([]);
  });

  it("the admins-only state of a verified person's visit", async () => {
    server.use(
      http.get(routeUrl(ROUTES.journeys.session), () =>
        HttpResponse.json(
          { error: { code: ERROR_CODES.FORBIDDEN, message: 'no', requestId: 'r' } },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<SessionDetailView app="ebo-sales" sessionId={SESSION_ID} />);
    await screen.findByRole('heading', { name: 'Only admins can open this visit' });
    expect(bannedOnScreen()).toEqual([]);
  });

  it('the privacy and access log page, with every part label', async () => {
    servePersonReads();
    serveAccessLog();
    renderWithProviders(<PrivacyView />);
    const table = await screen.findByRole('table');
    await within(table).findByText('Identity card and Summary');
    for (const label of ['One day', 'Usual activity hours', 'Visit steps']) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
    expect(bannedOnScreen()).toEqual([]);
  });
});
