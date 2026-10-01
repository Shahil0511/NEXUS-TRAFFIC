import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: loading placeholders keep the layout stable while queries resolve (no spinners). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
