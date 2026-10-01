/**
 * Hand-written fakes of the analytics read side (implements Pick<Repo, 'method'>), recording every
 * call so service tests can assert the filters a service derived from the query.
 */
import type { Grain } from '@nexus/shared';

import type {
  EndpointListOptions,
  FailureListOptions,
  TrafficFilter,
} from '../../src/domain/filters';
import type {
  ApiRequestRow,
  EndpointDetailRows,
  EndpointStatsRow,
  ErrorSummaryRows,
  PageViewBucketRow,
  TrafficBucketRow,
  TrafficSummaryRow,
} from '../../src/domain/rows';
import type { ApiRequestQueryRepository } from '../../src/repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../../src/repositories/web-event-query.repository';
import type { AppSlugResolver } from '../../src/services/app-slug.resolver';
import { NotFoundError } from '../../src/errors/app-error';
import { trafficSummaryRow } from './analytics-rows';

export const KNOWN_APP_SLUG = 'ebo-sales';
export const KNOWN_APP_ID = '11111111-1111-4111-8111-111111111111';

/** Resolves KNOWN_APP_SLUG only; anything else → 404 like the real resolver. */
export class FakeAppSlugs implements Pick<AppSlugResolver, 'resolve'> {
  async resolve(slug: string | undefined): Promise<string | undefined> {
    if (slug === undefined) return undefined;
    if (slug === KNOWN_APP_SLUG) return KNOWN_APP_ID;
    throw new NotFoundError(`Unknown app "${slug}"`);
  }
}

type RequestQueryMethods =
  | 'summarizeTraffic'
  | 'timeseries'
  | 'listEndpointStats'
  | 'getEndpointDetail'
  | 'summarizeErrors'
  | 'listFailures';

export class FakeApiRequestQueries implements Pick<ApiRequestQueryRepository, RequestQueryMethods> {
  readonly calls: Array<{ method: RequestQueryMethods; args: unknown[] }> = [];
  summaries: TrafficSummaryRow[] = [trafficSummaryRow(), trafficSummaryRow()];
  buckets: TrafficBucketRow[] = [];
  endpointStats: EndpointStatsRow[] = [];
  detail: EndpointDetailRows | null = null;
  errorSummary: ErrorSummaryRows = {
    totals: { total: 0, errors_4xx: 0, errors_5xx: 0 },
    byStatus: [],
    timeseries: [],
    topEndpoints: [],
  };
  failures: ApiRequestRow[] = [];

  /** Returns `summaries` in call order (current window first, then previous). */
  async summarizeTraffic(filter: TrafficFilter): Promise<TrafficSummaryRow> {
    const index = this.calls.filter((c) => c.method === 'summarizeTraffic').length;
    this.calls.push({ method: 'summarizeTraffic', args: [filter] });
    return this.summaries[index] ?? trafficSummaryRow();
  }

  async timeseries(filter: TrafficFilter, grain: Grain): Promise<TrafficBucketRow[]> {
    this.calls.push({ method: 'timeseries', args: [filter, grain] });
    return this.buckets;
  }

  async listEndpointStats(
    filter: TrafficFilter,
    options: EndpointListOptions,
  ): Promise<EndpointStatsRow[]> {
    this.calls.push({ method: 'listEndpointStats', args: [filter, options] });
    return this.endpointStats;
  }

  async getEndpointDetail(
    endpointId: string,
    filter: TrafficFilter,
    grain: Grain,
  ): Promise<EndpointDetailRows | null> {
    this.calls.push({ method: 'getEndpointDetail', args: [endpointId, filter, grain] });
    return this.detail;
  }

  async summarizeErrors(filter: TrafficFilter, grain: Grain): Promise<ErrorSummaryRows> {
    this.calls.push({ method: 'summarizeErrors', args: [filter, grain] });
    return this.errorSummary;
  }

  async listFailures(filter: TrafficFilter, options: FailureListOptions): Promise<ApiRequestRow[]> {
    this.calls.push({ method: 'listFailures', args: [filter, options] });
    return this.failures;
  }

  argsOf(method: RequestQueryMethods): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }
}

type WebQueryMethods = 'summarizePageViews' | 'pageViewTimeseries' | 'countActiveUsers';

export class FakeWebEventQueries implements Pick<WebEventQueryRepository, WebQueryMethods> {
  readonly calls: Array<{ method: WebQueryMethods; args: unknown[] }> = [];
  pageViews: number[] = [0, 0];
  pageViewBuckets: PageViewBucketRow[] = [];
  activeUsers = 0;

  async summarizePageViews(filter: TrafficFilter): Promise<number> {
    const index = this.calls.filter((c) => c.method === 'summarizePageViews').length;
    this.calls.push({ method: 'summarizePageViews', args: [filter] });
    return this.pageViews[index] ?? 0;
  }

  async pageViewTimeseries(filter: TrafficFilter, grain: Grain): Promise<PageViewBucketRow[]> {
    this.calls.push({ method: 'pageViewTimeseries', args: [filter, grain] });
    return this.pageViewBuckets;
  }

  async countActiveUsers(filter: TrafficFilter): Promise<number> {
    this.calls.push({ method: 'countActiveUsers', args: [filter] });
    return this.activeUsers;
  }
}
