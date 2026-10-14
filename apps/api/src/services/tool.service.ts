/**
 * ROUTES.tools.usage — the "tool usage" half of the Pages & Tools page.
 */
import {
  MAX_COUNT_RANGE_MS,
  type ToolDetailDto,
  type ToolDetailQuery,
  type ToolTrendPointDto,
  type ToolUsageDto,
  type ToolUsageQuery,
  type WindowedListDto,
} from '@nexus/shared';

import { toPageId, toToolId } from '@nexus/shared/endpoint-id';

import { mapToolTrendPoint, mapToolUsage, mapUserUsage } from '../domain/mappers';
import type { ToolTrendRow } from '../domain/rows';
import { fillToolTrendGaps } from '../domain/timeseries-gaps';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: trend rows are keyed like the tool rows (app_id + tool), so each tool finds its points. */
function trendKey(appId: string, tool: string): string {
  return `${appId}|${tool}`;
}

/** WHY: groups the flat trend rows per tool, already mapped to DTO points. */
function groupTrend(rows: readonly ToolTrendRow[]): Map<string, ToolTrendPointDto[]> {
  const byTool = new Map<string, ToolTrendPointDto[]>();
  for (const row of rows) {
    const key = trendKey(row.app_id, row.tool);
    const points = byTool.get(key) ?? [];
    points.push(mapToolTrendPoint(row));
    byTool.set(key, points);
  }
  return byTool;
}

/** WHY: orchestrates the tool-usage query (window → app id → repository → gap fill → mappers). */
export class ToolService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * The most used tools (uses, distinct users/sessions, last use), each with a gap-filled trend
   * over the window's buckets. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listToolUsage
   */
  async usage(query: ToolUsageQuery): Promise<WindowedListDto<ToolUsageDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.listToolUsage(filter, window.grain, query.limit);
    const trendByTool = groupTrend(rows.trend);
    return {
      window: toTimeWindowDto(window),
      items: rows.tools.map((row) =>
        mapToolUsage(
          row,
          fillToolTrendGaps(trendByTool.get(trendKey(row.app_id, row.tool)) ?? [], window),
        ),
      ),
    };
  }

  /**
   * One tool of one app, addressed by its opaque toolId (the name never travels in the URL): usage
   * and gap-filled trend, top users, the pages it was used on and its actions. 404 when no tool of
   * the app in the window has this id. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getToolDetail
   */
  async detail(app: string, toolId: string, query: ToolDetailQuery): Promise<ToolDetailDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(app));

    const tools = await this.webEvents.listToolNames(filter);
    const tool = tools.find((candidate) => toToolId(app, candidate) === toolId);
    if (tool === undefined)
      throw new NotFoundError('This tool was not used in the selected window');

    const rows = await this.webEvents.getToolDetail(tool, filter, window.grain);
    if (!rows) throw new NotFoundError('This tool was not used in the selected window');

    return {
      window: toTimeWindowDto(window),
      tool: mapToolUsage(rows.stats, fillToolTrendGaps(rows.trend.map(mapToolTrendPoint), window)),
      topUsers: rows.topUsers.map(mapUserUsage),
      pages: rows.pages.map((row) => ({
        pageId: toPageId(app, row.path_template),
        pathTemplate: row.path_template,
        uses: row.uses,
      })),
      actions: rows.actions,
    };
  }
}
