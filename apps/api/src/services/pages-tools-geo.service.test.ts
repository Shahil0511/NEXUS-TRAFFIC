/**
 * PageService, ToolService and GeoService: three thin "top N over a window" services, tested
 * together because they share their shape (window → app id → repository → WindowedListDto).
 */
import { ERROR_CODES } from '@nexus/shared';
import { toPageId, toToolId } from '@nexus/shared/endpoint-id';
import { describe, expect, it } from 'vitest';

import { APP_ID, geoCityRow, pageStatsRow, toolUsageRow } from '../../test/fixtures/analytics-rows';
import {
  FakeApiRequestQueries,
  FakeAppSlugs,
  FakeWebEventQueries,
  KNOWN_APP_ID,
  KNOWN_APP_SLUG,
} from '../../test/fixtures/fake-query-repositories';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { GeoService } from './geo.service';
import { PageService } from './page.service';
import { ToolService } from './tool.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build() {
  const webEvents = new FakeWebEventQueries();
  const requests = new FakeApiRequestQueries();
  const deps = [
    webEvents as unknown as WebEventQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  ] as const;
  return {
    webEvents,
    requests,
    pages: new PageService(
      webEvents as unknown as WebEventQueryRepository,
      requests as unknown as ApiRequestQueryRepository,
      new FakeAppSlugs() as unknown as AppSlugResolver,
      new FixedClock(NOW),
    ),
    tools: new ToolService(...deps),
    geo: new GeoService(...deps),
  };
}

describe('PageService.list', () => {
  it('maps page stats (whole ms) with the window, scoped to the app', async () => {
    const { pages, webEvents } = build();
    webEvents.pageStats = [pageStatsRow()];
    const dto = await pages.list({ range: '24h', app: KNOWN_APP_SLUG, limit: 10 });
    const [filter, limit] = webEvents.argsOf('listPageStats')[0] ?? [];
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID });
    expect(limit).toBe(10);
    expect(dto.window.grain).toBe('hour');
    expect(dto.items).toEqual([
      {
        pageId: toPageId('ebo-sales', '/stores/:id'),
        app: 'ebo-sales',
        pathTemplate: '/stores/:id',
        views: 20,
        uniqueSessions: 8,
        distinctUsers: 5,
        avgVisibleMs: 3500,
        p50VisibleMs: 3001,
        exits: 3,
      },
    ]);
  });

  it('p50 → capped at 31 days', async () => {
    const { pages } = build();
    await expect(pages.list({ range: '90d', limit: 10 })).rejects.toMatchObject({
      code: ERROR_CODES.RANGE_TOO_LARGE,
    });
  });
});

describe('ToolService.usage', () => {
  it('gives every tool a gap-filled trend over the window buckets (its own points only)', async () => {
    const { tools, webEvents } = build();
    const otherApp = '99999999-9999-4999-8999-999999999999';
    webEvents.toolUsage = {
      tools: [toolUsageRow(), toolUsageRow({ app_id: otherApp, app_slug: 'hr-portal', uses: 1 })],
      trend: [
        { app_id: APP_ID, tool: 'export-csv', bucket: new Date('2026-10-01T08:30:00Z'), uses: 5 },
        { app_id: otherApp, tool: 'export-csv', bucket: new Date('2026-10-01T07:30:00Z'), uses: 1 },
      ],
    };
    const dto = await tools.usage({ range: '6h', limit: 10 });
    expect(webEvents.argsOf('listToolUsage')[0]?.slice(1)).toEqual(['minute', 10]);
    const [sales, hr] = dto.items;
    expect(sales).toMatchObject({
      app: 'ebo-sales',
      tool: 'export-csv',
      uses: 7,
      distinctUsers: 2,
    });
    expect(sales?.trend).toHaveLength(360);
    expect(sales?.trend.find((p) => p.uses > 0)).toEqual({
      bucket: '2026-10-01T08:30:00.000Z',
      uses: 5,
    });
    expect(hr?.trend.filter((p) => p.uses > 0)).toEqual([
      { bucket: '2026-10-01T07:30:00.000Z', uses: 1 },
    ]);
    expect(JSON.stringify(dto)).not.toContain(APP_ID);
  });
});

describe('GeoService', () => {
  it('countries: maps rows and passes the limit', async () => {
    const { geo, webEvents } = build();
    webEvents.countries = [{ country: null, requests: 1, page_views: 2, users: 0 }];
    const dto = await geo.countries({ range: '24h', limit: 25 });
    expect(webEvents.argsOf('listCountries')[0]?.[1]).toBe(25);
    expect(dto.items).toEqual([{ country: null, requests: 1, pageViews: 2, users: 0 }]);
  });

  it('cities: rounds the approximate centroid', async () => {
    const { geo, webEvents } = build();
    webEvents.cities = [geoCityRow()];
    const dto = await geo.cities({ range: '24h', limit: 25 });
    expect(dto.items[0]).toEqual({
      country: 'IN',
      region: 'MH',
      city: 'Mumbai',
      lat: 19.076,
      lon: 72.8777,
      requests: 4,
      pageViews: 6,
      users: 2,
    });
  });
});

describe('PageService.detail', () => {
  it("resolves the opaque pageId among the app's templates and maps every panel", async () => {
    const { pages, webEvents, requests } = build();
    webEvents.pageTemplates = ['/home', '/stores/:id'];
    webEvents.pageDetail = {
      stats: pageStatsRow(),
      trend: [{ bucket: new Date('2026-10-01T09:30:00Z'), count: 4 }],
      topUsers: [
        { user_key: Buffer.alloc(32, 0xab), user_email: 'a@libas.in', count: 6, last_seen_at: NOW },
      ],
      tools: [{ tool: 'export-csv', uses: 3, users: 2 }],
      links: [
        { direction: 'from', path_template: '/home', sessions: 5 },
        { direction: 'to', path_template: '/reports', sessions: 2 },
      ],
    };
    requests.pageApiCalls = [
      {
        endpoint_id: APP_ID,
        method: 'GET',
        route_template: '/api/stores/:id',
        calls: 9,
        failed: 1,
        p95_ms: 120.456,
      },
    ];

    const dto = await pages.detail(KNOWN_APP_SLUG, toPageId(KNOWN_APP_SLUG, '/stores/:id'), {
      range: '24h',
    });

    expect(webEvents.argsOf('getPageDetail')[0]?.[0]).toBe('/stores/:id');
    expect(requests.argsOf('listPageApiCalls')[0]?.[1]).toMatchObject({ appId: KNOWN_APP_ID });
    expect(dto.page.pathTemplate).toBe('/stores/:id');
    expect(dto.trend.find((p) => p.bucket === '2026-10-01T09:30:00.000Z')?.views).toBe(4);
    expect(dto.topUsers[0]).toMatchObject({ email: 'a@libas.in', count: 6 });
    expect(dto.tools[0]).toEqual({
      toolId: toToolId(KNOWN_APP_SLUG, 'export-csv'),
      tool: 'export-csv',
      uses: 3,
      users: 2,
    });
    expect(dto.apiCalls[0]).toMatchObject({ method: 'GET', calls: 9, failed: 1, p95Ms: 120.46 });
    expect(dto.cameFrom).toEqual([
      { pageId: toPageId(KNOWN_APP_SLUG, '/home'), pathTemplate: '/home', sessions: 5 },
    ]);
    expect(dto.wentTo.map((link) => link.pathTemplate)).toEqual(['/reports']);
  });

  it('404 for an id that matches no template of the app in the window', async () => {
    const { pages, webEvents } = build();
    webEvents.pageTemplates = ['/home'];
    await expect(
      pages.detail(KNOWN_APP_SLUG, toPageId(KNOWN_APP_SLUG, '/other'), { range: '24h' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('ToolService.detail', () => {
  it('resolves the opaque toolId and maps usage, users, pages and actions', async () => {
    const { tools, webEvents } = build();
    webEvents.toolNames = ['export-csv'];
    webEvents.toolDetail = {
      stats: toolUsageRow(),
      trend: [],
      topUsers: [],
      pages: [{ path_template: '/reports', uses: 5 }],
      actions: [
        { action: 'export', uses: 4 },
        { action: null, uses: 1 },
      ],
    };
    const dto = await tools.detail(KNOWN_APP_SLUG, toToolId(KNOWN_APP_SLUG, 'export-csv'), {
      range: '24h',
    });
    expect(dto.tool.toolId).toBe(toToolId(KNOWN_APP_SLUG, 'export-csv'));
    expect(dto.tool.trend.length).toBeGreaterThan(0);
    expect(dto.pages).toEqual([
      { pageId: toPageId(KNOWN_APP_SLUG, '/reports'), pathTemplate: '/reports', uses: 5 },
    ]);
    expect(dto.actions).toEqual([
      { action: 'export', uses: 4 },
      { action: null, uses: 1 },
    ]);
  });

  it('404 for an unknown tool id', async () => {
    const { tools } = build();
    await expect(
      tools.detail(KNOWN_APP_SLUG, toToolId(KNOWN_APP_SLUG, 'nope'), { range: '24h' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
