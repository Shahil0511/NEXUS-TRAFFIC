/**
 * @nexus/react — Data Nexus Traffic reference browser tracker.
 *
 * WHY: the public surface is deliberately tiny. Next.js App Router users import
 * `<NexusTracker/>` from `@nexus/react/next` instead (a separate entry, so this one never
 * imports `next`); the pre-hydration header install is `@nexus/react/early`.
 */
export {
  flushNexus,
  trackEvent,
  trackTool,
  useNexusTracker,
  type UseNexusTrackerOptions,
} from './use-nexus-tracker';
export type { ToolAction, TrackOptions } from './core/sanitize';
export type { NexusEnvironment } from './core/environment';
export { getNexusStats, type NexusStats } from './core/stats';
export { joinBasePath } from './core/paths';
export { TOOL_ATTRIBUTES } from './core/tool-capture';
export { SDK_NAME, SDK_VERSION } from './core/sdk-info';
