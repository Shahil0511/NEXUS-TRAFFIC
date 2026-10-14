'use client';

import {
  MAX_COUNT_RANGE_MS,
  MAX_PERCENTILE_RANGE_MS,
  RANGE_DURATIONS_MS,
  RANGE_VALUES,
  type RangePreset,
} from '@nexus/shared';
import { CalendarRange, Clock } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime, fromIstInputValue, toIstInputValue } from '@/lib/format';
import { cn } from '@/lib/utils';

import { RANGE_LABELS } from './rangeLabels';
import { useGlobalFilters } from './useGlobalFilters';

type PresetRange = Exclude<RangePreset, 'custom'>;

const CUSTOM: RangePreset = 'custom';
const DAY_MS = 86_400_000;

const PRESETS: readonly PresetRange[] = RANGE_VALUES.filter(
  (value): value is PresetRange => value !== CUSTOM,
);

/** The presets, those longer than the page accepts disabled with the reason (pure; tested). */
export function presetOptions(maxRangeMs: number): SegmentedOption<PresetRange>[] {
  return PRESETS.map((value) => {
    const tooLong = RANGE_DURATIONS_MS[value] > maxRangeMs;
    return {
      value,
      ...RANGE_LABELS[value],
      disabled: tooLong,
      disabledReason: tooLong
        ? `this page covers at most ${Math.floor(maxRangeMs / DAY_MS)} days`
        : undefined,
    };
  });
}

/** "1 Oct, 09:00 → 2 Oct, 18:30" for the custom button label. */
function customLabel(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return RANGE_LABELS.custom.label;
  return `${formatDateTime(from)} → ${formatDateTime(to)}`;
}

/**
 * WHY: the global time window. Presets are one click (segmented control, arrow keys move between
 * them) from xl; below xl the same presets sit in a compact select so the top bar never overflows.
 * "Custom" opens a popover with two IST datetime fields. The values land in the URL via
 * useGlobalFilters, so every query key — and the shared link — changes with them. Presets longer
 * than the page's `maxRangeMs` (the API's cap for its queries) are disabled, not hidden.
 */
export function RangePicker({
  className,
  maxRangeMs = MAX_COUNT_RANGE_MS,
}: {
  className?: string;
  maxRangeMs?: number;
}) {
  const { filters, setRange, setCustomRange } = useGlobalFilters();
  const isCustom = filters.range === CUSTOM;
  const value = isCustom ? '' : (filters.range as PresetRange);
  const options = useMemo(() => presetOptions(maxRangeMs), [maxRangeMs]);
  const choosePreset = (next: PresetRange | '') => {
    if (next) setRange(next);
  };
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <SegmentedControl<PresetRange | ''>
        ariaLabel="Time range"
        value={value}
        options={options}
        onValueChange={choosePreset}
        className="hidden shrink-0 xl:inline-flex"
      />
      <PresetSelect
        value={value}
        options={options}
        onValueChange={choosePreset}
        className="xl:hidden"
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

/**
 * WHY: the presets as one compact dropdown for narrow top bars. A preset the page refuses stays
 * listed but disabled, its reason written under it (hidden in the trigger). While a custom window
 * is active nothing is selected and the trigger reads "Custom".
 */
function PresetSelect({
  value,
  options,
  onValueChange,
  className,
}: {
  value: PresetRange | '';
  options: readonly SegmentedOption<PresetRange>[];
  onValueChange: (value: PresetRange | '') => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as PresetRange)}>
      <SelectTrigger aria-label="Time range" className={cn('shrink-0', className)}>
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue placeholder={RANGE_LABELS.custom.label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.ariaLabel ?? option.label}
            {option.disabled && option.disabledReason ? (
              <span className="block text-2xs text-muted-foreground in-data-[slot=select-trigger]:hidden">
                {` (${option.disabledReason})`}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          className={cn(
            'max-w-40 min-w-9 shrink px-2 sm:px-3 xl:max-w-72',
            active && 'border-primary/40 bg-accent text-accent-foreground',
          )}
        >
          <CalendarRange aria-hidden="true" />
          <span className="hidden truncate text-xs sm:inline">{label}</span>
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
          <p className="text-2xs leading-relaxed text-muted-foreground">
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
