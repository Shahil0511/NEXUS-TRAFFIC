import type { HttpMethod } from '@nexus/shared';

import { cn } from '@/lib/utils';

/** WHY: per-verb hue tokens (--method-*, globals.css) keep AA contrast and dark-mode parity in one place. */
const METHOD_CLASS: Record<HttpMethod, string> = {
  GET: 'bg-method-get/10 text-method-get',
  POST: 'bg-method-post/10 text-method-post',
  PUT: 'bg-method-put/10 text-method-put',
  PATCH: 'bg-method-patch/10 text-method-patch',
  DELETE: 'bg-method-delete/10 text-method-delete',
  HEAD: 'bg-muted text-muted-foreground',
  OPTIONS: 'bg-muted text-muted-foreground',
};

/** WHY: the HTTP verb is the first thing scanned in a route list; the text carries it, colour helps. */
export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-14 shrink-0 items-center justify-center rounded-md font-mono text-2xs font-semibold',
        METHOD_CLASS[method],
      )}
    >
      {method}
    </span>
  );
}
