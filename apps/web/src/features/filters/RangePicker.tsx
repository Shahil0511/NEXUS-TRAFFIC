'use client';

import {
  MAX_COUNT_RANGE_MS,
  MAX_PERCENTILE_RANGE_MS,
  RANGE_VALUES,
  type RangePreset,
} from '@nexus/shared';
import { CalendarRange } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { formatDateTime, fromIstInputValue, toIstInputValue } from '@/lib/format';
import { cn } from '@/lib/utils';

import { RANGE_LABELS } from './rangeLabels';
import { useGlobalFilters } from './useGlobalFilters';

type PresetRange = Exclude<RangePreset, 'custom'>;

const CUSTOM: RangePreset = 'custom';
const DAY_MS = 86_400_000;

const PRESET_OPTIONS: readonly SegmentedOption<PresetRange>[] = RANGE_VALUES.filter(
  (value): value is PresetRange => value !== CUSTOM,
).map((value) => ({ value, ...RANGE_LABELS[value] }));

/** "1 Oct, 09:00 → 2 Oct, 18:30" for the custom button label. */
function customLabel(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return RANGE_LABELS.custom.label;
  return `${formatDateTime(from)} → ${formatDateTime(to)}`;
}

/**
 * WHY: the global time window. Presets are one click (segmented control, arrow keys move between
 * them); "Custom" opens a popover with two IST datetime fields. The values land in the URL via
 * useGlobalFilters, so every query key — and the shared link — changes with them.
 */
export function RangePicker({ className }: { className?: string }) {
  const { filters, setRange, setCustomRange } = useGlobalFilters();
  const isCustom = filters.range === CUSTOM;
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <SegmentedControl<PresetRange | ''>
        ariaLabel="Time range"
        value={isCustom ? '' : (filters.range as PresetRange)}
        options={PRESET_OPTIONS}
        onValueChange={(value) => {
          if (value) setRange(value);
        }}
      />
      <CustomRangePopover
        active={isCustom}
        label={isCustom ? customLabel(filters.from, filters.to) : RANGE_LABELS.custom.label}
        initialFrom={filters.from}
        initialTo={filters.to}
        onApply={setCustomRange}
      />
    </div>
  );
}

interface CustomRangePopoverProps {
  active: boolean;
  label: string;
  initialFrom: string | undefined;
  initialTo: string | undefined;
  onApply: (fromIso: string, toIso: string) => void;
}

/** Default custom window: the last 24 h, so the fields never start empty. */
function defaultBounds(): { from: string; to: string } {
  const now = Date.now();
  return { from: new Date(now - DAY_MS).toISOString(), to: new Date(now).toISOString() };
}

function CustomRangePopover({
  active,
  label,
  initialFrom,
  initialTo,
  onApply,
}: CustomRangePopoverProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const invalid = from !== '' && to !== '' && from >= to;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const fallback = defaultBounds();
      setFrom(toIstInputValue(initialFrom ?? fallback.from));
      setTo(toIstInputValue(initialTo ?? fallback.to));
    }
    setOpen(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!from || !to || invalid) return;
    onApply(fromIstInputValue(from), fromIstInputValue(to));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={active ? `Custom range: ${label}` : RANGE_LABELS.custom.ariaLabel}
          className={cn('max-w-72', active && 'border-primary/40 bg-accent text-accent-foreground')}
        >
          <CalendarRange aria-hidden="true" />
          <span className="truncate text-xs">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Custom range">
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-xs font-semibold">Custom range (IST)</p>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>From</span>
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>To</span>
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              required
              aria-invalid={invalid}
            />
          </label>
          {invalid ? (
            <p role="alert" className="text-xs text-destructive">
              “From” must be before “To”.
            </p>
          ) : null}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Latency views cover at most {MAX_PERCENTILE_RANGE_MS / DAY_MS} days, counts at most{' '}
            {MAX_COUNT_RANGE_MS / DAY_MS} days.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={invalid}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
