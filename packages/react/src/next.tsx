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
 *
 * ROUTE TEMPLATE: rebuilt from `usePathname()` + `useParams()` (`/my-app/stores/:id`). This runs
 * during render, so it is fully guarded — when unsure, no template is sent. A `routeTemplate`
 * prop overrides it.
 */
import { useParams, usePathname } from 'next/navigation';

import { joinBasePath } from './core/paths';
import { nextRouteTemplate, type NextParams } from './core/route-template';
import { useNexusTracker, type UseNexusTrackerOptions } from './use-nexus-tracker';

export interface NexusTrackerProps extends Omit<UseNexusTrackerOptions, 'pathname'> {
  /** Your `next.config` `basePath`, e.g. `/my-app`. Default: Next's inlined basePath, else ''. */
  basePath?: string;
}

/** WHY: renders nothing; mounts the tracker with `basePath + usePathname()` and its template. */
export function NexusTracker({ basePath, routeTemplate, ...options }: NexusTrackerProps): null {
  const pathname = usePathname();
  const params = useParams() as NextParams | null;
  const base = basePath ?? nextBasePath();
  const fullPath = typeof pathname === 'string' ? joinBasePath(base, pathname) : undefined;
  const template =
    routeTemplate !== undefined ? routeTemplate : templateFor(base, pathname, params);
  useNexusTracker({ ...options, pathname: fullPath, routeTemplate: template });
  return null;
}

/** WHY: never throws in render — any surprise (throwing getter, odd params) → no template. */
function templateFor(
  base: string,
  pathname: string | null,
  params: NextParams | null,
): string | undefined {
  try {
    if (typeof pathname !== 'string') return undefined;
    const template = nextRouteTemplate(pathname, params);
    return template === undefined ? undefined : joinBasePath(base, template);
  } catch {
    return undefined;
  }
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
export { getNexusStats, type NexusStats } from './core/stats';
export type { NexusEnvironment } from './core/environment';
export type { ToolAction, TrackOptions } from './core/sanitize';
