import { ROUTES, type PageDetailDto, type ToolDetailDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { WHO_ADMINS_ONLY } from '@/components/AdminsOnlyNote';
import { ToolDetailView } from '@/features/tools/ToolDetailView';
import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { ME, PAGE_ID, PAGE_STATS, TOOL_ID, TOOL_USAGE, USER_KEY, WINDOW } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { PageDetailView } from './PageDetailView';

const ENDPOINT_ID = '6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11';
const OTHER_PAGE_ID = '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6e';

const PAGE_DETAIL: PageDetailDto = {
  window: WINDOW,
  page: PAGE_STATS.items[0]!,
  trend: [{ bucket: '2026-10-01T06:00:00.000Z', views: 12 }],
  topUsers: [
    {
      userKey: USER_KEY,
      email: 'buyer@libas.in',
      count: 40,
      lastSeenAt: '2026-10-01T07:00:00.000Z',
    },
  ],
  tools: [{ toolId: TOOL_ID, tool: 'export-csv', uses: 9, users: 3 }],
  apiCalls: [
    {
      endpointId: ENDPOINT_ID,
      method: 'GET',
      routeTemplate: '/api/orders/:id',
      calls: 410,
      failed: 2,
      p95Ms: 320,
    },
  ],
  cameFrom: [{ pageId: OTHER_PAGE_ID, pathTemplate: '/orders', sessions: 150 }],
  wentTo: [],
};

const TOOL_DETAIL: ToolDetailDto = {
  window: WINDOW,
  tool: TOOL_USAGE.items[0]!,
  topUsers: [
    {
      userKey: USER_KEY,
      email: 'buyer@libas.in',
      count: 12,
      lastSeenAt: '2026-10-01T07:00:00.000Z',
    },
  ],
  pages: [{ pageId: PAGE_ID, pathTemplate: '/orders/:id', uses: 1_200 }],
  actions: [
    { action: 'export', uses: 1_000 },
    { action: null, uses: 250 },
  ],
};

/** The viewer is NOT an admin; the API then sends no people (topUsers null, ADR 0019). */
function serveAsViewer() {
  server.use(http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json({ ...ME, isAdmin: false })));
}

/** The h2 panel titles in page order (the report sheet's sections). */
function panelTitles(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '');
}

describe('PageDetailView', () => {
  it('shows who views the page, the features and request types on it and where people come from', async () => {
    let requested: string | undefined;
    server.use(
      http.get(routeUrl(ROUTES.pages.detail), ({ request }) => {
        requested = new URL(request.url).pathname;
        return HttpResponse.json(PAGE_DETAIL);
      }),
    );
    renderWithProviders(<PageDetailView app="ebo-sales" pageId={PAGE_ID} />, {
      searchParams: '?range=7d',
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: '/orders/:id' }),
    ).toBeInTheDocument();
    // The URL carries the app slug + opaque id only — never the template.
    expect(requested).toBe(`/traffic/api/v1/pages/ebo-sales/${PAGE_ID}`);
    const viewers = screen.getByRole('list', { name: 'Who views this page' });
    expect(
      (await within(viewers).findByRole('link', { name: 'buyer@libas.in' })).getAttribute('href'),
    ).toBe(`/users/${USER_KEY}?app=ebo-sales&range=7d`);
    expect(screen.getByText('Most views first')).toBeInTheDocument();
    expect(screen.queryByText(WHO_ADMINS_ONLY)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'export-csv' }).getAttribute('href')).toBe(
      `/tools/ebo-sales/${TOOL_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByRole('link', { name: /\/api\/orders\/:id/ }).getAttribute('href')).toBe(
      `/endpoints/${ENDPOINT_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByRole('link', { name: '/orders' }).getAttribute('href')).toBe(
      `/pages/ebo-sales/${OTHER_PAGE_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByText('Nothing after it in these visits')).toBeInTheDocument();

    // Applications › ebo-sales › Pages › /orders/:id — hrefs from PAGES, carrying the filters.
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(trail).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Apps', '/applications?range=7d'],
      ['ebo-sales', '/applications/ebo-sales?range=7d'],
      ['Pages', '/pages?app=ebo-sales&range=7d'],
    ]);
    expect(within(trail).getByText('/orders/:id')).toHaveAttribute('aria-current', 'page');
  });

  it('reads as a report sheet: sentence, facts strip, chart, around | who, used with; no card row', async () => {
    server.use(http.get(routeUrl(ROUTES.pages.detail), () => HttpResponse.json(PAGE_DETAIL)));
    renderWithProviders(<PageDetailView app="ebo-sales" pageId={PAGE_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/orders/:id' });

    const sentence = screen.getByText(/^Viewed/).closest('p')!;
    expect(sentence).toHaveTextContent(
      'Viewed 420 times by 64 verified people in 200 visits in this range. People look at it for about 48 s (median 31 s). 25.0% of visits end here.',
    );

    const facts = screen.getByLabelText('Page facts');
    expect(
      within(facts)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Views', 'People', 'Visits', 'Average visible', 'Median visible', 'Exit rate']);
    for (const label of ['Views', 'People', 'Visits', 'Average visible', 'Exit rate']) {
      expect(within(facts).getByRole('button', { name: `What is ${label}?` })).toBeInTheDocument();
    }
    expect(within(facts).getByText('tab in foreground')).toBeInTheDocument();
    expect(within(facts).getByText('50 visits ended here')).toBeInTheDocument();

    expect(panelTitles()).toEqual([
      'Views over time',
      'What happens around it',
      'Who uses it',
      'Used with',
    ]);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Came from',
      'Went to',
      'Features used on this page',
      'Request types called from this page',
    ]);
    // No KPI card row any more.
    expect(screen.queryByRole('region', { name: 'Page metrics' })).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('says "1 visit" for one exit and one neighbour visit, and drops the note without a rate', async () => {
    const onePage = { ...PAGE_DETAIL.page, exits: 1 };
    server.use(
      http.get(routeUrl(ROUTES.pages.detail), () =>
        HttpResponse.json({
          ...PAGE_DETAIL,
          page: onePage,
          cameFrom: [{ pageId: OTHER_PAGE_ID, pathTemplate: '/orders', sessions: 1 }],
        }),
      ),
    );
    renderWithProviders(<PageDetailView app="ebo-sales" pageId={PAGE_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/orders/:id' });

    const facts = screen.getByLabelText('Page facts');
    expect(within(facts).getByText('1 visit ended here')).toBeInTheDocument();
    const cameFrom = screen.getByRole('list', { name: 'Came from' });
    expect(within(cameFrom).getByText('1 visit')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/1 visits/);
  });

  it('reads only "not captured" for a missing visible time or exit rate, without its note', async () => {
    server.use(
      http.get(routeUrl(ROUTES.pages.detail), () =>
        HttpResponse.json({
          ...PAGE_DETAIL,
          page: { ...PAGE_DETAIL.page, avgVisibleMs: null, uniqueSessions: 0, exits: 0 },
        }),
      ),
    );
    renderWithProviders(<PageDetailView app="ebo-sales" pageId={PAGE_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/orders/:id' });

    const facts = screen.getByLabelText('Page facts');
    expect(within(facts).queryByText('tab in foreground')).toBeNull();
    expect(within(facts).queryByText(/ended here/)).toBeNull();
  });

  it('shows a viewer the count and the note, and no email anywhere (ADR 0019)', async () => {
    serveAsViewer();
    server.use(
      http.get(routeUrl(ROUTES.pages.detail), () =>
        HttpResponse.json({ ...PAGE_DETAIL, topUsers: null }),
      ),
    );
    renderWithProviders(<PageDetailView app="ebo-sales" pageId={PAGE_ID} />);
    await screen.findByRole('heading', { level: 1, name: '/orders/:id' });

    const who = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(within(who).getByText('64 verified people')).toBeInTheDocument();
    expect(within(who).getByText(WHO_ADMINS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Who views this page' })).toBeNull();
    expect(document.body.textContent).not.toContain('@libas.in');
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});

describe('ToolDetailView', () => {
  it('shows who uses the feature, on which pages and with which actions', async () => {
    server.use(http.get(routeUrl(ROUTES.tools.detail), () => HttpResponse.json(TOOL_DETAIL)));
    renderWithProviders(<ToolDetailView app="ebo-sales" toolId={TOOL_ID} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'export-csv' }),
    ).toBeInTheDocument();
    const users = screen.getByRole('list', { name: 'Who uses this feature' });
    expect(within(users).getByText('12')).toBeInTheDocument();
    expect(await within(users).findByRole('link', { name: 'buyer@libas.in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '/orders/:id' }).getAttribute('href')).toBe(
      `/pages/ebo-sales/${PAGE_ID}?app=ebo-sales`,
    );
    const actions = screen.getByRole('list', { name: 'Actions' });
    expect(within(actions).getByText('export')).toBeInTheDocument();
    expect(within(actions).getByText('not specified')).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Features' })).toHaveAttribute(
      'href',
      '/tools?app=ebo-sales',
    );
    expect(within(trail).getByRole('link', { name: 'ebo-sales' })).toHaveAttribute(
      'href',
      '/applications/ebo-sales',
    );
    expect(within(trail).getByText('export-csv')).toHaveAttribute('aria-current', 'page');
  });

  it('reads as a report sheet: sentence, facts strip, chart, how | who, used with; no card row', async () => {
    server.use(http.get(routeUrl(ROUTES.tools.detail), () => HttpResponse.json(TOOL_DETAIL)));
    renderWithProviders(<ToolDetailView app="ebo-sales" toolId={TOOL_ID} />);
    await screen.findByRole('heading', { level: 1, name: 'export-csv' });

    const sentence = screen.getByText(/in this range\. Last used/).closest('p')!;
    expect(sentence).toHaveTextContent(
      /^Used 1,250 times by 34 verified people in 80 visits in this range\. Last used .+\.$/,
    );
    const facts = screen.getByLabelText('Feature facts');
    expect(
      within(facts)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Uses', 'People', 'Visits', 'Last used']);
    expect(within(facts).getByText(/IST$/)).toBeInTheDocument();
    for (const label of ['Uses', 'People', 'Visits']) {
      expect(within(facts).getByRole('button', { name: `What is ${label}?` })).toBeInTheDocument();
    }
    expect(panelTitles()).toEqual(['Uses over time', 'How it is used', 'Who uses it', 'Used with']);
    expect(screen.getByRole('heading', { level: 3, name: 'Used on pages' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Tool metrics' })).toBeNull();
    // On screen it is a "feature", never a "tool" (the route and ids keep the name).
    expect(collectRenderedText(document.body)).not.toMatch(/\btools?\b/i);
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows a viewer the count and the note, and no email anywhere (ADR 0019)', async () => {
    serveAsViewer();
    server.use(
      http.get(routeUrl(ROUTES.tools.detail), () =>
        HttpResponse.json({ ...TOOL_DETAIL, topUsers: null }),
      ),
    );
    renderWithProviders(<ToolDetailView app="ebo-sales" toolId={TOOL_ID} />);
    await screen.findByRole('heading', { level: 1, name: 'export-csv' });

    const who = screen
      .getByRole('heading', { level: 2, name: 'Who uses it' })
      .closest<HTMLElement>('[aria-labelledby]')!;
    expect(within(who).getByText('34 verified people')).toBeInTheDocument();
    expect(within(who).getByText(WHO_ADMINS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Who uses this feature' })).toBeNull();
    expect(document.body.textContent).not.toContain('@libas.in');
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});
