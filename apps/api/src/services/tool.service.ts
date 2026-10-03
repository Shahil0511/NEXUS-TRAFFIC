/**
 * ROUTES.tools.usage — the "tool usage" half of the Pages & Tools page.
 */
import {
  MAX_COUNT_RANGE_MS,
  type ToolTrendPointDto,
  type ToolUsageDto,
  type ToolUsageQuery,
  type WindowedListDto,
} from '@nexus/shared';

import { mapToolTrendPoint, mapToolUsage } from '../domain/mappers';
import type { ToolTrendRow } from '../domain/rows';
import { fillToolTrendGaps } from '../domain/timeseries-gaps';
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
}
