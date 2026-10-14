import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { InfoTip } from '@/components/InfoTip';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDeltaPct } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Whether a rising value is good news (requests) or bad news (error rate, latency). */
export type DeltaPolarity = 'up-is-good' | 'down-is-good' | 'neutral';

export interface KpiCardProps {
  label: string;
  /** Already formatted (format.ts). */
  value: string;
  /** (value − previous) / previous × 100 from MetricDto; omitted for non-window KPIs. */
  deltaPct?: number | null;
  polarity?: DeltaPolarity;
  hint?: string;
  /** What the number means, in plain words (metricInfo(key)); shown behind an (i) by the label. */
  info?: string;
  icon?: LucideIcon;
  loading?: boolean;
  /** Where the breakdown behind this number lives (a PAGES href); makes the whole card a link. */
  href?: string;
}

type Tone = 'good' | 'bad' | 'flat';

function toneOf(deltaPct: number, polarity: DeltaPolarity): Tone {
  if (deltaPct === 0 || polarity === 'neutral') return 'flat';
  const rising = deltaPct > 0;
  return rising === (polarity === 'up-is-good') ? 'good' : 'bad';
}

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-success/10 text-success',
  bad: 'bg-destructive/10 text-destructive',
  flat: 'bg-muted text-muted-foreground',
};

/** The "↑ 12 %" pill, coloured by meaning (also used in table cells, e.g. Applications). */
export function DeltaPill({
  deltaPct,
  polarity,
}: {
  deltaPct: number | null;
  polarity: DeltaPolarity;
}) {
  if (deltaPct === null) {
    return <span className="text-2xs text-muted-foreground">no previous data</span>;
  }
  const Icon = deltaPct > 0 ? ArrowUpRight : deltaPct < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular',
        TONE_CLASS[toneOf(deltaPct, polarity)],
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {formatDeltaPct(deltaPct)}
      <span className="sr-only"> versus the previous period</span>
    </span>
  );
}

/**
 * WHY: the headline numbers of a page. The delta compares with the previous equal-length window
 * (shared resolveTimeWindow) and is coloured by meaning, not by sign — an error rate that goes
 * up is red even though the arrow points up. Colour is never alone: the arrow and the signed
 * number carry the same information.
 *
 * WHY A STRETCHED LINK: with `href` the whole card is clickable through the label link's
 * full-card `::after`, NOT by wrapping the card in <a> — the (i) button must stay outside the
 * link (no interactive element inside another) and sits above the overlay.
 */
export function KpiCard({
  label,
  value,
  deltaPct,
  polarity = 'up-is-good',
  hint,
  info,
  icon: Icon,
  loading = false,
  href,
}: KpiCardProps) {
  return (
    <Card
      className={cn(
        'relative h-full gap-3 p-4',
        href &&
          // Focus is an OUTLINE, not a ring: Card's `dark:ring-white/[0.07]` would win over a
          // ring colour in dark mode and leave the keyboard focus almost invisible.
          'group transition-colors hover:bg-muted/50 hover:ring-primary/30 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring/60 dark:hover:ring-primary/30',
      )}
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            {href ? (
              <Link
                href={href}
                className="outline-none after:absolute after:inset-0 after:rounded-xl"
              >
                {label}
              </Link>
            ) : (
              label
            )}
          </h3>
          {info ? <InfoTip label={label} text={info} className="z-10" /> : null}
        </div>
        {href ? (
          <ArrowRight
            className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-link"
            aria-hidden="true"
          />
        ) : Icon ? (
          <Icon className="size-4 text-muted-foreground/70" aria-hidden="true" />
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-2xl leading-none font-semibold tracking-tight tabular">{value}</p>
          <div className="flex min-h-5 items-center gap-2">
            {deltaPct !== undefined ? <DeltaPill deltaPct={deltaPct} polarity={polarity} /> : null}
            {hint ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
