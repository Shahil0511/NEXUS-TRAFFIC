import { CheckCircle2, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';

/** The outcome of a check: passed, needs a look, or needs action. */
export type CheckState = 'pass' | 'warn' | 'fail';

const STATE_ICON: Record<CheckState, { icon: LucideIcon; className: string }> = {
  pass: { icon: CheckCircle2, className: 'text-success' },
  warn: { icon: TriangleAlert, className: 'text-warning' },
  fail: { icon: XCircle, className: 'text-destructive' },
};

/**
 * WHY: one look for "is this OK?" wherever a check result appears (an app row, a checklist):
 * green tick, amber triangle, red cross — colour = status meaning only. The icon is decorative;
 * the label carries the meaning: visible in the `badge` variant, screen-reader text in the `dot`
 * variant (a small mark on a corner, e.g. of an app's initials tile). `labelClassName` styles the
 * badge's label only, e.g. `max-sm:sr-only` (components/CheckRow.tsx: the icon alone on phones).
 */
export function HealthMark({
  state,
  label,
  variant = 'badge',
  labelClassName,
}: {
  state: CheckState;
  label: string;
  variant?: 'badge' | 'dot';
  labelClassName?: string;
}) {
  const { icon: Icon, className } = STATE_ICON[state];
  if (variant === 'dot') {
    return (
      <span
        data-state={state}
        className="inline-flex size-4 items-center justify-center rounded-full bg-card ring-2 ring-card"
      >
        <Icon aria-hidden="true" className={`size-3.5 ${className}`} />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span data-state={state} className="inline-flex items-center gap-1 text-xs">
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${className}`} />
      <span className={labelClassName}>{label}</span>
    </span>
  );
}
