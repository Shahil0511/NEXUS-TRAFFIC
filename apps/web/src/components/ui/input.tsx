import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: one text input look (search boxes, custom range fields). */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 dark:bg-input/20',
        className,
      )}
      {...props}
    />
  );
}
