/** GET ROUTES.pages.list item — time spent per page. */
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
