import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: multi-line input (one allowed origin per line) with the same look as Input. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-16 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-xs leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 dark:bg-input/20',
        className,
      )}
      {...props}
    />
  );
}
