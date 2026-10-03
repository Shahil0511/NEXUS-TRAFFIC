import { useId, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface FormFieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  /** Receives the ids to wire: `id` (label target) and `aria-describedby` / `aria-invalid`. */
  children: (control: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean;
  }) => ReactElement;
}

/**
 * WHY: one labelled form row (admin dialogs) — the label targets the control, and the hint and the
 * error are announced with it (aria-describedby), so validation is accessible by construction.
 */
export function FormField({ label, hint, error, className, children }: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) })}
      {error ? (
        <p id={errorId} className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
