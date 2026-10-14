import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: small status/identity pills (admin, method, status class, "claimed"). */
export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-semibold whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground',
        outline: 'text-muted-foreground ring-1 ring-border ring-inset',
        muted: 'bg-muted text-muted-foreground',
        success: 'bg-success/12 text-success',
        warning: 'bg-warning/12 text-warning',
        destructive: 'bg-destructive/12 text-destructive',
        info: 'bg-info/12 text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
