/** GET ROUTES.tools.usage item — which UI tools/features are used. */
export interface ToolUsageDto {
  app: string;
  tool: string;
  uses: number;
  distinctUsers: number;
  distinctSessions: number;
  lastUsedAt: string;
  trend: Array<{ bucket: string; uses: number }>;
}
