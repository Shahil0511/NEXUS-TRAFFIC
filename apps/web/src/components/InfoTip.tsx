'use client';

import { Info } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface InfoTipProps {
  /** The name of the thing explained, e.g. "p95" → the button reads "What is p95?". */
  label: string;
  /** The plain-language definition (usually metricInfo(key) from lib/metricCopy). */
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/**
 * WHY: users don't know what p95, error rate or "identified %" mean. A small (i) next to the
 * number explains it in place: a real button (Tab reaches it, focus opens the tooltip, Escape
 * closes it) and a tap opens it too — Radix tooltips alone ignore touch, and a phone user has no
 * hover. NEVER put it inside a link or another button (KpiCard/DataTable place it beside).
 */
export function InfoTip({ label, text, side = 'top', className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const openOnClick = (event: MouseEvent<HTMLButtonElement>) => {
    // preventDefault stops Radix's own click handler, which would close the tooltip.
    event.preventDefault();
    setOpen(true);
  };
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${label}?`}
          onClick={openOnClick}
          className={cn(
            // The `after:` box grows the 16 px icon to a 24 px hit area (WCAG 2.5.8) without
            // moving the layout; full muted-foreground keeps the icon above 3:1 in both themes.
            'relative inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-1 hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </Tooltip>
  );
}
