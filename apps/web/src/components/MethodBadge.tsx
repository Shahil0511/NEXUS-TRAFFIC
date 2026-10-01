import type { HttpMethod } from '@nexus/shared';

import { cn } from '@/lib/utils';

const METHOD_CLASS: Record<HttpMethod, string> = {
  GET: 'text-sky-700 bg-sky-500/10 dark:text-sky-300',
  POST: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
  PUT: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  PATCH: 'text-violet-700 bg-violet-500/10 dark:text-violet-300',
  DELETE: 'text-rose-700 bg-rose-500/10 dark:text-rose-300',
  HEAD: 'text-muted-foreground bg-muted',
  OPTIONS: 'text-muted-foreground bg-muted',
};

/** WHY: the HTTP verb is the first thing scanned in a route list; the text carries it, colour helps. */
export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-14 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold',
        METHOD_CLASS[method],
      )}
    >
      {method}
    </span>
  );
}
