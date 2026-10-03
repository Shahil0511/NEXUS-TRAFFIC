/** One bucket of a tool's usage trend (bucket = ISO start, same buckets as the window grain). */
export interface ToolTrendPointDto {
  bucket: string;
  uses: number;
}

/**
 * GET ROUTES.tools.usage item (WindowedListDto) — which UI tools/features are used.
 * `distinctUsers` counts verified users only; `trend` has one gap-filled point per window bucket.
 */
export interface ToolUsageDto {
  app: string;
  tool: string;
  uses: number;
  distinctUsers: number;
  distinctSessions: number;
  lastUsedAt: string;
  trend: ToolTrendPointDto[];
}
