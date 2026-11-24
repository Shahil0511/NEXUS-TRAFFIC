import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Props every illustration takes: only its size and placement come from the caller. */
export interface IllustrationProps {
  className?: string;
}

export interface IllustrationFrameProps extends IllustrationProps {
  /** Drawing box; hero art is 200 x 120, state art 120 x 80. */
  viewBox?: string;
  children: ReactNode;
}

/**
 * WHY: every illustration is decorative, so the <svg> is aria-hidden and not focusable, and it
 * draws only with token colour utilities (fill-primary, stroke-border, fill-chart-…) so the same
 * art is right in the light and the dark theme. One frame keeps those rules in one place;
 * `data-illustration` lets tests find the art without a role (it has none on purpose).
 */
export function IllustrationFrame({
  className,
  viewBox = '0 0 200 120',
  children,
}: IllustrationFrameProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-illustration=""
      viewBox={viewBox}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('pointer-events-none h-auto select-none', className)}
    >
      {children}
    </svg>
  );
}

/** The soft blob and scattered dots behind each hero motif (same shape everywhere: one family). */
export function HeroBackdrop() {
  return (
    <>
      <path
        d="M38 30c18-20 62-26 96-14s52 38 42 62-46 36-84 32-66-22-68-44 2-22 14-36Z"
        className="fill-accent"
      />
      <circle cx="22" cy="24" r="3" className="fill-primary/25" />
      <circle cx="182" cy="20" r="2" className="fill-primary/30" />
      <circle cx="188" cy="96" r="3.5" className="fill-primary/15" />
      <circle cx="14" cy="92" r="2" className="fill-primary/30" />
      <path d="M170 40v8M166 44h8" strokeWidth="1.5" className="stroke-primary/40" />
    </>
  );
}

/** The smaller soft blob behind state art (empty, error, locked, not found). */
export function StateBackdrop() {
  return (
    <>
      <ellipse cx="60" cy="44" rx="48" ry="32" className="fill-accent" />
      <circle cx="12" cy="18" r="2" className="fill-primary/30" />
      <circle cx="110" cy="62" r="2.5" className="fill-primary/20" />
    </>
  );
}
