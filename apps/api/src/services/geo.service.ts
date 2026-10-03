/**
 * ROUTES.geo.* — the Geography page: country and (approximate) city tables.
 */
import {
  MAX_COUNT_RANGE_MS,
  type GeoCityDto,
  type GeoCountryDto,
  type GeoQuery,
  type WindowedListDto,
} from '@nexus/shared';

import { mapGeoCity, mapGeoCountry } from '../domain/mappers';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the geography queries (window → app id → repository → mappers). */
export class GeoService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * API calls, page views and verified users per country, busiest first. Counts only →
   * MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listCountries
   */
  async countries(query: GeoQuery): Promise<WindowedListDto<GeoCountryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.listCountries(filter, query.limit);
    return { window: toTimeWindowDto(window), items: rows.map(mapGeoCountry) };
  }

  /**
   * The same per city with its approximate centroid, busiest first.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listCities
   */
  async cities(query: GeoQuery): Promise<WindowedListDto<GeoCityDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.listCities(filter, query.limit);
    return { window: toTimeWindowDto(window), items: rows.map(mapGeoCity) };
  }
}
