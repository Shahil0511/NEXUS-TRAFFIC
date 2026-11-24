import { ROUTES, type CursorPage, type MeDto, type PersonAccessEntryDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { personPartHref } from './accessLogColumns';
import { PrivacyView, RECORDED_ITEMS } from './PrivacyView';

const ADMIN: MeDto = { email: 'boss@libas.in', isAdmin: true };
const VIEWER: MeDto = { email: 'viewer@libas.in', isAdmin: false };
const OTHER_KEY = 'b'.repeat(64);

function entry(id: number, overrides: Partial<PersonAccessEntryDto> = {}): PersonAccessEntryDto {
  return {
    id,
    viewedAt: '2026-10-01T08:00:00.000Z',
    viewerEmail: 'boss@libas.in',
    subjectUserKey: USER_KEY,
    subjectEmailMasked: 'b***@libas.in',
    surface: 'person_profile',
    ...overrides,
  };
}

/** Serves me + the access log (first page with a cursor, then the rest); records each query. */
function serve(me: MeDto) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(me)),
    http.get(routeUrl(ROUTES.privacy.accessLog), ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      const page: CursorPage<PersonAccessEntryDto> = params.get('cursor')
        ? { items: [entry(1, { surface: 'person_devices' })], nextCursor: null }
        : {
            items: [
              entry(3, { surface: 'person_daily' }),
              entry(2, { subjectUserKey: OTHER_KEY, subjectEmailMasked: 'c***@libas.in' }),
            ],
            nextCursor: 'next-1',
          };
      return HttpResponse.json(page);
    }),
  );
  return queries;
}

describe('PrivacyView', () => {
  it('shows the no-access state to a non-admin and never loads the log', async () => {
    const queries = serve(VIEWER);
    renderWithProviders(<PrivacyView />);
    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('lists who opened which part of whose page, masked, newest first, with Load more', async () => {
    serve(ADMIN);
    renderWithProviders(<PrivacyView />);
    const table = await screen.findByRole('table', { name: 'Person page access log' });
    await within(table).findByText('c***@libas.in');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('boss@libas.in');
    expect(rows[0]).toHaveTextContent('b***@libas.in');
    expect(rows[0]).toHaveTextContent('Daily activity');
    expect(
      within(rows[0] as HTMLElement).getByRole('link', { name: 'b***@libas.in' }),
    ).toHaveAttribute('href', `/users/${USER_KEY}`);
    expect(
      within(rows[0] as HTMLElement).getByRole('link', { name: /^Daily activity/ }),
    ).toHaveAttribute('href', `/users/${USER_KEY}?tab=daily`);
    expect(rows[1]).toHaveTextContent('c***@libas.in');
    expect(rows[1]).toHaveTextContent('Identity card and Summary');

    await userEvent.setup().click(screen.getByRole('button', { name: /Load more/ }));
    expect(await within(table).findByText('Devices')).toBeInTheDocument();
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(3);
    expect(screen.getByText(/end of list/)).toBeInTheDocument();
  });

  it('"Only this person" narrows the log by the opaque key in the URL; "show everyone" clears it', async () => {
    const queries = serve(ADMIN);
    const urls: string[] = [];
    renderWithProviders(<PrivacyView />, { onUrlUpdate: (event) => urls.push(event.queryString) });
    await screen.findByText('c***@libas.in');
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Only this person \(c\*\*\*@libas\.in\)/ }),
    );
    expect(urls.at(-1)).toContain(`userKey=${OTHER_KEY}`);
    expect(await screen.findByRole('button', { name: /show everyone/ })).toBeInTheDocument();
    expect(queries.at(-1)?.get('userKey')).toBe(OTHER_KEY);

    await user.click(screen.getByRole('button', { name: /show everyone/ }));
    expect(urls.at(-1)).not.toContain('userKey');
  });

  it('ignores a malformed ?userKey= (never sends it to the API)', async () => {
    const queries = serve(ADMIN);
    renderWithProviders(<PrivacyView />, { searchParams: '?userKey=someone@libas.in' });
    await screen.findByText('c***@libas.in');
    expect(queries[0]?.get('userKey')).toBeNull();
  });

  it('says so when nobody has opened a person page yet', async () => {
    server.use(
      http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(ADMIN)),
      http.get(routeUrl(ROUTES.privacy.accessLog), () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<PrivacyView />);
    expect(await screen.findByText('No person page has been opened yet')).toBeInTheDocument();
  });

  it('lists what the dashboard records, in plain words', async () => {
    serve(ADMIN);
    renderWithProviders(<PrivacyView />);
    const list = await screen.findByRole('list', { name: 'What this dashboard records' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(RECORDED_ITEMS.length);
    for (const title of [
      'Pages and buttons used',
      'Server requests',
      'Browser, system and device type',
      'Time zone and language',
      'App version',
      'Tab-visible time',
    ]) {
      expect(within(list).getByText(title)).toBeInTheDocument();
    }
  });

  it('personPartHref opens the matching tab (Summary needs no param)', () => {
    expect(personPartHref(entry(1))).toBe(`/users/${USER_KEY}`);
    expect(personPartHref(entry(1, { surface: 'person_timeline' }))).toBe(
      `/users/${USER_KEY}?tab=activity`,
    );
    expect(personPartHref(entry(1, { surface: 'person_devices' }))).toBe(
      `/users/${USER_KEY}?tab=devices`,
    );
  });
});
