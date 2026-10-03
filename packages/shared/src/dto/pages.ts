/**
 * GET ROUTES.pages.list item (WindowedListDto) — time spent per page (path template).
 * avg/p50 are over page views with at least one `page_time` delta (Σ visible ms per page view).
 */
export interface PageStatsDto {
  app: string;
  pathTemplate: string;
  views: number;
  uniqueSessions: number;
  avgVisibleMs: number | null;
  p50VisibleMs: number | null;
  /** Sessions whose last page view was this page. */
  exits: number;
}
