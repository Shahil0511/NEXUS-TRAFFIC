'use client';
/**
 * @nexus/react/next — `<NexusTracker/>` for the Next.js App Router.
 *
 * WHY A SEPARATE ENTRY: the core (`@nexus/react`) must never import `next`, so Vite/CRA apps do
 * not need it installed. The built file carries the `'use client'` banner (see tsup.config.ts),
 * so it can be rendered straight from a server `layout.tsx` — but it calls `usePathname()`, so
 * wrap it in `<Suspense>` as Next recommends for client hooks in layouts.
 *
 * BASE PATH: `usePathname()` EXCLUDES `next.config` `basePath`, while the collector requires every
 * path to start with it. Pass `basePath="/my-app"` (recommended — explicit and grep-able). When
 * omitted, Next's build-time `process.env.__NEXT_ROUTER_BASEPATH` is used if available, else ''.
 */
import { usePathname } from 'next/navigation';

import { joinBasePath } from './core/paths';
import { useNexusTracker, type UseNexusTrackerOptions } from './use-nexus-tracker';

export interface NexusTrackerProps extends Omit<UseNexusTrackerOptions, 'pathname'> {
  /** Your `next.config` `basePath`, e.g. `/my-app`. Default: Next's inlined basePath, else ''. */
  basePath?: string;
}

/** WHY: renders nothing; mounts the tracker with `basePath + usePathname()`. */
export function NexusTracker({ basePath, ...options }: NexusTrackerProps): null {
  const pathname = usePathname();
  const fullPath =
    typeof pathname === 'string' ? joinBasePath(basePath ?? nextBasePath(), pathname) : undefined;
  useNexusTracker({ ...options, pathname: fullPath });
  return null;
}

/**
 * WHY: Next inlines `process.env.__NEXT_ROUTER_BASEPATH` into client bundles at build time. Read
 * defensively — outside Next (tests, other bundlers) `process` may not exist.
 */
function nextBasePath(): string {
  try {
    return process.env.__NEXT_ROUTER_BASEPATH ?? '';
  } catch {
    return '';
  }
}

export { trackEvent, trackTool, flushNexus } from './use-nexus-tracker';
export type { ToolAction, TrackOptions } from './core/sanitize';
