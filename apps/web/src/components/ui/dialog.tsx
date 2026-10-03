'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * WHY: modal forms and confirmations (Apps admin) on Radix Dialog — focus trap, Escape, aria
 * labelling and scroll lock — styled like the popover/select surfaces. NEVER `window.confirm`.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Hide the corner ✕ (e.g. the one-time key reveal, which must be acknowledged explicitly). */
  hideClose?: boolean;
}

export function DialogContent({ className, children, hideClose = false, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-5 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute top-3.5 right-3.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('space-y-1 pr-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-snug font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
