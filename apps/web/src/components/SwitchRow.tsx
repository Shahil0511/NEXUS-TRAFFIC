'use client';

import type { ReactNode } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface SwitchRowProps {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Tints the row (e.g. an engaged kill switch); the label and hint carry the meaning. */
  tone?: 'default' | 'destructive';
}

/**
 * WHY: a labelled on/off row for the admin dialogs (app settings, remote SDK config). The whole
 * row is the click target; the switch's accessible name is the label.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled = false,
  tone = 'default',
}: SwitchRowProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-4 rounded-lg p-3 ring-1 ring-border ring-inset',
        tone === 'destructive' && 'bg-destructive/8 ring-destructive/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="space-y-0.5">
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-2xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </label>
  );
}
