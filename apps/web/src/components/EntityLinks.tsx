import Link from 'next/link';

import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Inline link style of an entity inside a table cell or a ranked list row. */
export const ENTITY_LINK_CLASS =
  'rounded-sm underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * WHY: a page template anywhere opens that page's detail. The URL carries the app slug + OPAQUE
 * pageId (computed by the API); the template is only the link TEXT (05-conventions §5).
 */
export function PageLink({
  app,
  pageId,
  pathTemplate,
  linkQuery,
  className,
}: {
  app: string;
  pageId: string;
  pathTemplate: string;
  linkQuery: LinkQuery;
  className?: string;
}) {
  return (
    <Link
      href={withQuery(PAGES.pageDetail(app, pageId), linkQuery)}
      className={cn('font-mono', ENTITY_LINK_CLASS, className)}
      title={pathTemplate}
    >
      {pathTemplate}
    </Link>
  );
}

/** WHY: a tool name anywhere opens that tool's detail (app slug + OPAQUE toolId in the URL). */
export function ToolLink({
  app,
  toolId,
  tool,
  linkQuery,
  className,
}: {
  app: string;
  toolId: string;
  tool: string;
  linkQuery: LinkQuery;
  className?: string;
}) {
  return (
    <Link
      href={withQuery(PAGES.toolDetail(app, toolId), linkQuery)}
      className={cn(ENTITY_LINK_CLASS, className)}
      title={tool}
    >
      {tool}
    </Link>
  );
}
