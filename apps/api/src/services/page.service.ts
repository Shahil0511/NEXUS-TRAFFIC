/**
 * ROUTES.pages.list — the "time on page" half of the Pages & Tools page.
 */
import {
  MAX_PERCENTILE_RANGE_MS,
  type PageDetailDto,
  type PageDetailQuery,
  type PageLinkDto,
  type PageListQuery,
  type PageStatsDto,
  type WindowedListDto,
} from '@nexus/shared';
import { toPageId, toToolId } from '@nexus/shared/endpoint-id';

import { asHttpMethod, mapPageStats, mapUserUsage } from '../domain/mappers';
import { roundOrNull } from '../domain/numbers';
import type { PageLinkRow } from '../domain/rows';
import { fillCountGaps } from '../domain/timeseries-gaps';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import {
  DETAIL_TOP_LIMIT,
  type WebEventQueryRepository,
} from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** How many neighbour pages each side of the page detail lists. */
const PAGE_LINK_LIMIT = 5;

/** The 'from' or 'to' neighbours, already ranked by the repository, as linkable DTOs. */
function pageLinks(
  app: string,
  rows: readonly PageLinkRow[],
  direction: PageLinkRow['direction'],
): PageLinkDto[] {
  return rows
    .filter((row) => row.direction === direction)
    .slice(0, PAGE_LINK_LIMIT)
    .map((row) => ({
      pageId: toPageId(app, row.path_template),
      pathTemplate: row.path_template,
      sessions: row.sessions,
    }));
}

/** WHY: orchestrates the page-stats query (window → app id → repository → mappers). */
export class PageService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly requests: ApiRequestQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * Views, sessions, avg/p50 visible time and exits per page template, most viewed first.
   * p50 is a percentile → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listPageStats
   */
  async list(query: PageListQuery): Promise<WindowedListDto<PageStatsDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.listPageStats(filter, query.limit);
    return { window: toTimeWindowDto(window), items: rows.map(mapPageStats) };
  }

  /**
   * One page of one app, addressed by its opaque pageId (the template never travels in the URL):
   * stats, views per bucket, top viewers, tools used on it, the API routes it called and the pages
   * before / after it. 404 when no page of the app in the window has this id. p50/p95 → capped at
   * MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getPageDetail
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listPageApiCalls
   */
  async detail(app: string, pageId: string, query: PageDetailQuery): Promise<PageDetailDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(app));

    const templates = await this.webEvents.listPageTemplates(filter);
    const template = templates.find((candidate) => toPageId(app, candidate) === pageId);
    if (template === undefined)
      throw new NotFoundError('No views of this page in the selected window');

    const [rows, apiCalls] = await Promise.all([
      this.webEvents.getPageDetail(template, filter, window.grain),
      this.requests.listPageApiCalls(template, filter, DETAIL_TOP_LIMIT),
    ]);
    if (!rows) throw new NotFoundError('No views of this page in the selected window');

    const trend = new Map(rows.trend.map((row) => [row.bucket.toISOString(), row.count]));
    return {
      window: toTimeWindowDto(window),
      page: mapPageStats(rows.stats),
      trend: fillCountGaps(trend, window).map((point) => ({
        bucket: point.bucket,
        views: point.count,
      })),
      topUsers: rows.topUsers.map(mapUserUsage),
      tools: rows.tools.map((row) => ({
        toolId: toToolId(app, row.tool),
        tool: row.tool,
        uses: row.uses,
        users: row.users,
      })),
      apiCalls: apiCalls.map((row) => ({
        endpointId: row.endpoint_id,
        method: asHttpMethod(row.method),
        routeTemplate: row.route_template,
        calls: row.calls,
        failed: row.failed,
        p95Ms: roundOrNull(row.p95_ms),
      })),
      cameFrom: pageLinks(app, rows.links, 'from'),
      wentTo: pageLinks(app, rows.links, 'to'),
    };
  }
}
