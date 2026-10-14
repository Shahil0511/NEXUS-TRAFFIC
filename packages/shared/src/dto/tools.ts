import type { TimeWindowDto, UserUsageDto } from './common';

/** One bucket of a tool's usage trend (bucket = ISO start, same buckets as the window grain). */
export interface ToolTrendPointDto {
  bucket: string;
  uses: number;
}

/**
 * GET ROUTES.tools.usage item (WindowedListDto) — which UI tools/features are used.
 * `distinctUsers` counts verified users only; `trend` has one gap-filled point per window bucket.
 * `toolId` = toToolId(app, tool) (opaque, computed by the API) — the tool's URL id.
 */
export interface ToolUsageDto {
  toolId: string;
  app: string;
  tool: string;
  uses: number;
  distinctUsers: number;
  distinctSessions: number;
  lastUsedAt: string;
  trend: ToolTrendPointDto[];
}

/** GET ROUTES.tools.detail (404 when the tool was not used in the window). */
export interface ToolDetailDto {
  window: TimeWindowDto;
  tool: ToolUsageDto;
  /** `count` = uses by that user. */
  topUsers: UserUsageDto[];
  /** The pages the tool was used on. */
  pages: Array<{ pageId: string; pathTemplate: string; uses: number }>;
  /** TOOL_ACTION values (click, export…) and how often each happened; null = not sent. */
  actions: Array<{ action: string | null; uses: number }>;
}
