import { ROUTES, type PageDetailDto, type ToolDetailDto } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ToolDetailView } from '@/features/tools/ToolDetailView';
import { PAGE_ID, PAGE_STATS, TOOL_ID, TOOL_USAGE, USER_KEY, WINDOW } from '@/test/fixtures';
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

describe('PageDetailView', () => {
  it('shows who views the page, the tools and API calls on it and where people come from', async () => {
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
    expect(within(viewers).getByRole('link', { name: 'buyer@libas.in' }).getAttribute('href')).toBe(
      `/users/${USER_KEY}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByRole('link', { name: 'export-csv' }).getAttribute('href')).toBe(
      `/tools/ebo-sales/${TOOL_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByRole('link', { name: /\/api\/orders\/:id/ }).getAttribute('href')).toBe(
      `/endpoints/${ENDPOINT_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByRole('link', { name: '/orders' }).getAttribute('href')).toBe(
      `/pages/ebo-sales/${OTHER_PAGE_ID}?app=ebo-sales&range=7d`,
    );
    expect(screen.getByText('Nothing after it in these sessions')).toBeInTheDocument();
  });
});

describe('ToolDetailView', () => {
  it('shows who uses the tool, on which pages and with which actions', async () => {
    server.use(http.get(routeUrl(ROUTES.tools.detail), () => HttpResponse.json(TOOL_DETAIL)));
    renderWithProviders(<ToolDetailView app="ebo-sales" toolId={TOOL_ID} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'export-csv' }),
    ).toBeInTheDocument();
    const users = screen.getByRole('list', { name: 'Who uses this tool' });
    expect(within(users).getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '/orders/:id' }).getAttribute('href')).toBe(
      `/pages/ebo-sales/${PAGE_ID}?app=ebo-sales`,
    );
    const actions = screen.getByRole('list', { name: 'Actions' });
    expect(within(actions).getByText('export')).toBeInTheDocument();
    expect(within(actions).getByText('not specified')).toBeInTheDocument();
  });
});
