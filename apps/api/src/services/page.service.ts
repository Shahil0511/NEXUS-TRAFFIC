/**
 * ROUTES.pages.list — the "time on page" half of the Pages & Tools page.
 */
import {
  MAX_PERCENTILE_RANGE_MS,
  type PageListQuery,
  type PageStatsDto,
  type WindowedListDto,
} from '@nexus/shared';

import { mapPageStats } from '../domain/mappers';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the page-stats query (window → app id → repository → mappers). */
export class PageService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
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
}
