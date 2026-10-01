import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: the surface every panel, KPI and table sits on — hairline ring instead of a shadow. */
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn(
        'flex flex-col rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/[0.07] dark:ring-white/[0.07]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-3 px-4 pt-4', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="card-title"
      className={cn('text-sm leading-snug font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('mt-0.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 pt-3 pb-4', className)} {...props} />;
}
