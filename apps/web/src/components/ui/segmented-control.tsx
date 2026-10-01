'use client';

import { ToggleGroup } from 'radix-ui';

import { cn } from '@/lib/utils';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  /** Accessible name when `label` is an abbreviation (e.g. "24h" → "Last 24 hours"). */
  ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  options: readonly SegmentedOption<V>[];
  onValueChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * WHY: a compact single-choice control (range presets, 4xx/5xx filter) with arrow-key roving
 * focus from Radix ToggleGroup. Deselecting is ignored: exactly one option is always active.
 */
export function SegmentedControl<V extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className,
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        if (next) onValueChange(next as V);
      }}
      className={cn(
        'inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel ?? option.label}
          className="h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/40"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
