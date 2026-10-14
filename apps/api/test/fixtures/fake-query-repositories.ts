/**
 * Hand-written fakes of the analytics read side (implements Pick<Repo, 'method'>), recording every
 * call so service tests can assert the filters a service derived from the query.
 */
import type { Grain } from '@nexus/shared';

import type {
  EndpointListOptions,
  FailureListOptions,
  SessionListOptions,
  TimelineOptions,
  TrafficFilter,
  UserListOptions,
} from '../../src/domain/filters';
import type {
  ApiRequestRow,
  AppActivityRow,
  AppTrafficRow,
  DailyUsersRow,
  EndpointDetailRows,
  EndpointStatsRow,
  ErrorSummaryRows,
  GeoCityRow,
  GeoCountryRow,
  PageApiCallRow,
  PageDetailRows,
  PageStatsRow,
  PageViewBucketRow,
  SessionRows,
  SessionSummaryRow,
  TimelineEventRow,
  ToolDetailRows,
  ToolUsageRows,
  TopPathRow,
  TrafficBucketRow,
  TrafficSummaryRow,
  UserEndpointRow,
  UserProfileRows,
  UserSummaryRow,
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
  | 'listFailures'
  | 'summarizeTrafficByApp'
  | 'listUserTopEndpoints'
  | 'listPageApiCalls';

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
    usersAffected: 0,
    topAffectedUsers: [],
  };
  failures: ApiRequestRow[] = [];
  /** Returned in call order (current window first, then previous). */
  trafficByApp: AppTrafficRow[][] = [];
  userTopEndpoints: UserEndpointRow[] = [];
  pageApiCalls: PageApiCallRow[] = [];

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

  async summarizeTrafficByApp(filter: TrafficFilter): Promise<AppTrafficRow[]> {
    const index = this.calls.filter((c) => c.method === 'summarizeTrafficByApp').length;
    this.calls.push({ method: 'summarizeTrafficByApp', args: [filter] });
    return this.trafficByApp[index] ?? [];
  }

  async listUserTopEndpoints(
    userKey: Buffer,
    filter: TrafficFilter,
    limit: number,
  ): Promise<UserEndpointRow[]> {
    this.calls.push({ method: 'listUserTopEndpoints', args: [userKey, filter, limit] });
    return this.userTopEndpoints;
  }

  async listPageApiCalls(
    pathTemplate: string,
    filter: TrafficFilter,
    limit: number,
  ): Promise<PageApiCallRow[]> {
    this.calls.push({ method: 'listPageApiCalls', args: [pathTemplate, filter, limit] });
    return this.pageApiCalls;
  }

  argsOf(method: RequestQueryMethods): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }
}

type WebQueryMethods =
  | 'summarizePageViews'
  | 'pageViewTimeseries'
  | 'countActiveUsers'
  | 'countIdentifiedUsers'
  | 'summarizeActivityByApp'
  | 'listDailyUsers'
  | 'listPageTemplates'
  | 'getPageDetail'
  | 'listToolNames'
  | 'getToolDetail'
  | 'listUsers'
  | 'getUserProfile'
  | 'listUserTimeline'
  | 'listSessions'
  | 'getSession'
  | 'listTopPaths'
  | 'listPageStats'
  | 'listToolUsage'
  | 'listCountries'
  | 'listCities';

export class FakeWebEventQueries implements Pick<WebEventQueryRepository, WebQueryMethods> {
  readonly calls: Array<{ method: WebQueryMethods; args: unknown[] }> = [];
  pageViews: number[] = [0, 0];
  pageViewBuckets: PageViewBucketRow[] = [];
  activeUsers = 0;
  /** Returned in call order (current window first, then previous). */
  identifiedUsers: number[] = [0, 0];
  activityByApp: AppActivityRow[][] = [];
  dailyUsers: DailyUsersRow[] = [];
  pageTemplates: string[] = [];
  pageDetail: PageDetailRows | null = null;
  toolNames: string[] = [];
  toolDetail: ToolDetailRows | null = null;
  users: UserSummaryRow[] = [];
  profile: UserProfileRows | null = null;
  timeline: TimelineEventRow[] = [];
  sessions: SessionSummaryRow[] = [];
  session: SessionRows | null = null;
  topPaths: TopPathRow[] = [];
  pageStats: PageStatsRow[] = [];
  toolUsage: ToolUsageRows = { tools: [], trend: [] };
  countries: GeoCountryRow[] = [];
  cities: GeoCityRow[] = [];

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

  async countIdentifiedUsers(filter: TrafficFilter): Promise<number> {
    const index = this.calls.filter((c) => c.method === 'countIdentifiedUsers').length;
    this.calls.push({ method: 'countIdentifiedUsers', args: [filter] });
    return this.identifiedUsers[index] ?? 0;
  }

  async summarizeActivityByApp(filter: TrafficFilter): Promise<AppActivityRow[]> {
    const index = this.calls.filter((c) => c.method === 'summarizeActivityByApp').length;
    this.calls.push({ method: 'summarizeActivityByApp', args: [filter] });
    return this.activityByApp[index] ?? [];
  }

  async listDailyUsers(filter: TrafficFilter): Promise<DailyUsersRow[]> {
    this.calls.push({ method: 'listDailyUsers', args: [filter] });
    return this.dailyUsers;
  }

  async listPageTemplates(filter: TrafficFilter): Promise<string[]> {
    this.calls.push({ method: 'listPageTemplates', args: [filter] });
    return this.pageTemplates;
  }

  async getPageDetail(
    pathTemplate: string,
    filter: TrafficFilter,
    grain: Grain,
  ): Promise<PageDetailRows | null> {
    this.calls.push({ method: 'getPageDetail', args: [pathTemplate, filter, grain] });
    return this.pageDetail;
  }

  async listToolNames(filter: TrafficFilter): Promise<string[]> {
    this.calls.push({ method: 'listToolNames', args: [filter] });
    return this.toolNames;
  }

  async getToolDetail(
    tool: string,
    filter: TrafficFilter,
    grain: Grain,
  ): Promise<ToolDetailRows | null> {
    this.calls.push({ method: 'getToolDetail', args: [tool, filter, grain] });
    return this.toolDetail;
  }

  async listUsers(filter: TrafficFilter, options: UserListOptions): Promise<UserSummaryRow[]> {
    this.calls.push({ method: 'listUsers', args: [filter, options] });
    return this.users;
  }

  async getUserProfile(userKey: Buffer, filter: TrafficFilter): Promise<UserProfileRows | null> {
    this.calls.push({ method: 'getUserProfile', args: [userKey, filter] });
    return this.profile;
  }

  async listUserTimeline(
    userKey: Buffer,
    filter: TrafficFilter,
    options: TimelineOptions,
  ): Promise<TimelineEventRow[]> {
    this.calls.push({ method: 'listUserTimeline', args: [userKey, filter, options] });
    return this.timeline;
  }

  async listSessions(
    filter: TrafficFilter,
    options: SessionListOptions,
  ): Promise<SessionSummaryRow[]> {
    this.calls.push({ method: 'listSessions', args: [filter, options] });
    return this.sessions;
  }

  async getSession(
    appId: string,
    sessionId: string,
    filter: TrafficFilter,
  ): Promise<SessionRows | null> {
    this.calls.push({ method: 'getSession', args: [appId, sessionId, filter] });
    return this.session;
  }

  async listTopPaths(filter: TrafficFilter, limit: number): Promise<TopPathRow[]> {
    this.calls.push({ method: 'listTopPaths', args: [filter, limit] });
    return this.topPaths;
  }

  async listPageStats(filter: TrafficFilter, limit: number): Promise<PageStatsRow[]> {
    this.calls.push({ method: 'listPageStats', args: [filter, limit] });
    return this.pageStats;
  }

  async listToolUsage(filter: TrafficFilter, grain: Grain, limit: number): Promise<ToolUsageRows> {
    this.calls.push({ method: 'listToolUsage', args: [filter, grain, limit] });
    return this.toolUsage;
  }

  async listCountries(filter: TrafficFilter, limit: number): Promise<GeoCountryRow[]> {
    this.calls.push({ method: 'listCountries', args: [filter, limit] });
    return this.countries;
  }

  async listCities(filter: TrafficFilter, limit: number): Promise<GeoCityRow[]> {
    this.calls.push({ method: 'listCities', args: [filter, limit] });
    return this.cities;
  }

  argsOf(method: WebQueryMethods): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }
}
