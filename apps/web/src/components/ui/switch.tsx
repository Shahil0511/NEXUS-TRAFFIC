'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** WHY: an on/off setting (browser ingest, app active) with role="switch" from Radix. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input p-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary dark:bg-input/60',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-card shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
