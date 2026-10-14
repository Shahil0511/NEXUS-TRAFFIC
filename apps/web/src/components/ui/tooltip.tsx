'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** How long a pointer must rest on a trigger before its tooltip opens (ms). */
const OPEN_DELAY_MS = 200;

/** True below a TooltipProvider of THIS module (Radix exposes no way to ask). */
const HasProviderContext = createContext(false);

/**
 * WHY: one provider per app shares the open delay, and moving from one tooltip to the next skips
 * it. Mounted once in AppProviders.
 */
export function TooltipProvider({
  delayDuration = OPEN_DELAY_MS,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} {...props}>
      <HasProviderContext.Provider value={true}>{children}</HasProviderContext.Provider>
    </TooltipPrimitive.Provider>
  );
}

/**
 * WHY: a hover/focus hint (Escape closes it, `role="tooltip"` + aria-describedby for screen
 * readers). Radix throws without a provider; this one falls back to its own so a component
 * rendered in isolation (a test, a story) still works — inside the app the shared one is used.
 */
export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = useContext(HasProviderContext);
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>;
}

export const TooltipTrigger = TooltipPrimitive.Trigger;

/** The floating bubble, styled like the popover/select surfaces. */
export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 max-w-72 rounded-lg bg-popover px-3 py-2 text-xs leading-relaxed font-normal tracking-normal text-balance text-popover-foreground normal-case shadow-lg ring-1 ring-foreground/10 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
