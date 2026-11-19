'use client';

import {
  DEFAULT_ENVIRONMENT,
  ENVIRONMENT_FILTER_VALUES,
  type EnvironmentFilter,
} from '@nexus/shared';
import { Layers } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { ENVIRONMENT_LABELS } from './environmentLabels';
import { useGlobalFilters } from './useGlobalFilters';

const ALL: EnvironmentFilter = 'all';

/**
 * WHY: the global environment filter (ADR 0008). Staging and local dev traffic is stored apart
 * from production; the dashboard shows production unless the viewer picks otherwise, and the
 * choice lands in the URL (`?env=`, absent = production) through useGlobalFilters. Any other
 * choice is tinted, so a viewer never mistakes staging numbers for production ones.
 */
export function EnvironmentSelect({ className }: { className?: string }) {
  const { filters, setEnvironment } = useGlobalFilters();
  const current = filters.env ?? DEFAULT_ENVIRONMENT;
  const isProduction = current === DEFAULT_ENVIRONMENT;

  return (
    <Select value={current} onValueChange={(value) => setEnvironment(value as EnvironmentFilter)}>
      <SelectTrigger
        aria-label="Environment filter"
        className={cn('w-40 min-w-0', !isProduction && 'border-warning/60', className)}
      >
        <Layers
          className={cn('size-4 shrink-0', isProduction ? 'text-muted-foreground' : 'text-warning')}
          aria-hidden="true"
        />
        <SelectValue placeholder={ENVIRONMENT_LABELS[DEFAULT_ENVIRONMENT]} />
      </SelectTrigger>
      <SelectContent>
        {ENVIRONMENT_FILTER_VALUES.map((value) => (
          <EnvironmentOption key={value} value={value} />
        ))}
      </SelectContent>
    </Select>
  );
}

/** One option; "All environments" sits apart below a separator. */
function EnvironmentOption({ value }: { value: EnvironmentFilter }) {
  return (
    <>
      {value === ALL ? <SelectSeparator /> : null}
      <SelectItem value={value}>{ENVIRONMENT_LABELS[value]}</SelectItem>
    </>
  );
}
