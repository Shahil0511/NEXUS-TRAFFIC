/**
 * Every dashboard page href — the ONLY place a page path is written.
 *
 * WHY: like ROUTES for the API, this keeps links refactor-safe and ctrl-click navigable (each
 * builder has an @see to its page file). Paths are relative to the Next basePath; <Link> adds
 * `/traffic` itself. Dynamic segments take OPAQUE ids only (endpointId uuid, userKey hash) —
 * never an ingested string such as a path or route template (ai-context/05-conventions.md §5).
 * A session is addressed by its registered app slug + uuid sessionId, both validated by the page
 * with the API's own params schema.
 */

export const PAGES = {
  /** @see ../app/(dashboard)/page.tsx */
  overview: () => '/',
  /** @see ../app/(dashboard)/applications/page.tsx */
  applications: () => '/applications',
  /** @see ../app/(dashboard)/applications/[app]/page.tsx (registered app slug, validated by the page) */
  applicationDetail: (app: string) => `/applications/${encodeURIComponent(app)}`,
  /** @see ../app/(dashboard)/live/page.tsx */
  live: () => '/live',
  /** @see ../app/(dashboard)/endpoints/page.tsx */
  endpoints: () => '/endpoints',
  /** @see ../app/(dashboard)/endpoints/[endpointId]/page.tsx */
  endpointDetail: (endpointId: string) => `/endpoints/${encodeURIComponent(endpointId)}`,
  /** @see ../app/(dashboard)/errors/page.tsx */
  errors: () => '/errors',
  /** @see ../app/(dashboard)/users/page.tsx */
  users: () => '/users',
  /** @see ../app/(dashboard)/users/[userKey]/page.tsx */
  userDetail: (userKey: string) => `/users/${encodeURIComponent(userKey)}`,
  /** @see ../app/(dashboard)/journeys/page.tsx */
  journeys: () => '/journeys',
  /** @see ../app/(dashboard)/journeys/[app]/[sessionId]/page.tsx */
  sessionDetail: (app: string, sessionId: string) =>
    `/journeys/${encodeURIComponent(app)}/${encodeURIComponent(sessionId)}`,
  /** @see ../app/(dashboard)/pages/page.tsx */
  pages: () => '/pages',
  /** @see ../app/(dashboard)/pages/[app]/[pageId]/page.tsx (app slug + opaque pageId) */
  pageDetail: (app: string, pageId: string) =>
    `/pages/${encodeURIComponent(app)}/${encodeURIComponent(pageId)}`,
  /** @see ../app/(dashboard)/tools/page.tsx */
  tools: () => '/tools',
  /** @see ../app/(dashboard)/tools/[app]/[toolId]/page.tsx (app slug + opaque toolId) */
  toolDetail: (app: string, toolId: string) =>
    `/tools/${encodeURIComponent(app)}/${encodeURIComponent(toolId)}`,
  /** @see ../app/(dashboard)/geography/page.tsx */
  geography: () => '/geography',
  /** @see ../app/(dashboard)/integration/page.tsx */
  integration: () => '/integration',
  /** @see ../app/(dashboard)/apps/page.tsx */
  apps: () => '/apps',
  /** @see ../app/no-access/page.tsx */
  noAccess: () => '/no-access',
} as const;

export type PageKey = keyof typeof PAGES;

/**
 * Append query values (e.g. the global app/range filters) to a PAGES href.
 * WHY: navigation keeps the user's filters; empty values are dropped.
 */
export function withQuery(
  href: string,
  query: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `${href}?${text}` : href;
}
