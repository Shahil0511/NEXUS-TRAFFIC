import type { HttpMethod } from '../constants/traffic';
import type { TimeWindowDto, UserUsageDto } from './common';

/**
 * GET ROUTES.pages.list item (WindowedListDto) — time spent per page (path template).
 * avg/p50 are over page views with at least one `page_time` delta (Σ visible ms per page view).
 * `pageId` = toPageId(app, pathTemplate) (opaque, computed by the API) — the page's URL id.
 */
export interface PageStatsDto {
  pageId: string;
  app: string;
  pathTemplate: string;
  views: number;
  uniqueSessions: number;
  /** Distinct verified users who viewed the page. */
  distinctUsers: number;
  avgVisibleMs: number | null;
  p50VisibleMs: number | null;
  /** Sessions whose last page view was this page. */
  exits: number;
}

/** A neighbouring page in sessions (came from / went to), by the sessions that made the move. */
export interface PageLinkDto {
  pageId: string;
  pathTemplate: string;
  sessions: number;
}

/** A tool used ON a page. */
export interface PageToolDto {
  toolId: string;
  tool: string;
  uses: number;
  users: number;
}

/** An API route called while the page was open (api_requests.page_view_id → this page's views). */
export interface PageApiCallDto {
  endpointId: string;
  method: HttpMethod;
  routeTemplate: string;
  calls: number;
  failed: number;
  p95Ms: number | null;
}

/** GET ROUTES.pages.detail (404 when the page has no views in the window). */
export interface PageDetailDto {
  window: TimeWindowDto;
  page: PageStatsDto;
  /** Views per bucket (gap-filled, window grain). */
  trend: Array<{ bucket: string; views: number }>;
  /** `count` = views by that user. */
  topUsers: UserUsageDto[];
  tools: PageToolDto[];
  apiCalls: PageApiCallDto[];
  cameFrom: PageLinkDto[];
  wentTo: PageLinkDto[];
}
