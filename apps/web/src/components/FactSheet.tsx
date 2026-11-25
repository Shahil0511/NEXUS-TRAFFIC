import Link from 'next/link';
import type { ReactNode } from 'react';

import { ENTITY_LINK_CLASS } from '@/components/EntityLinks';
import { InfoTip } from '@/components/InfoTip';
import { cn } from '@/lib/utils';

/** One fact: a label, its value and, optionally, a short note, a definition and a link. */
export interface Fact {
  label: string;
  /** null / undefined = the app did not send it → "not captured". */
  value: ReactNode;
  /** A muted word or two after the value ("verified", "tab in foreground"). */
  note?: ReactNode;
  /** The plain-language definition (metricInfo(key) from lib/metricCopy) → an (i) next to the label. */
  info?: string;
  /** Opens a page (built from PAGES): the value becomes a link. */
  href?: string;
}

export interface FactSheetProps {
  facts: readonly Fact[];
  /** 'strip' = one line on desktop that wraps on phones; 'stack' = one fact per row. */
  layout?: 'strip' | 'stack';
  /** Names the list for screen readers ("Page facts"). */
  ariaLabel: string;
}

/** What an empty value reads as: the app did not send it, not zero. */
export const NOT_CAPTURED = 'not captured';

/**
 * WHY: the numbers of one object (a page, a feature) are facts to read, not cards to scan — a
 * KPI card row made every detail page look alike. One description list in two layouts: a strip
 * under the headline sentence, or a stack (label left, value right) inside a profile card. Every
 * number keeps its definition behind an (i) beside the label (never inside a link), and a missing
 * value says "not captured" instead of a dash (and drops its note).
 */
export function FactSheet({ facts, layout = 'strip', ariaLabel }: FactSheetProps) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn('text-xs', layout === 'strip' ? 'flex flex-wrap gap-x-6 gap-y-2' : 'space-y-2')}
    >
      {facts.map((fact) => (
        <FactItem key={fact.label} fact={fact} layout={layout} />
      ))}
    </dl>
  );
}

/** One label / value pair in the chosen layout. */
function FactItem({ fact, layout }: { fact: Fact; layout: 'strip' | 'stack' }) {
  return (
    <div
      data-slot="fact"
      className={cn(
        'min-w-0',
        layout === 'strip'
          ? 'flex items-baseline gap-1.5'
          : 'flex items-baseline justify-between gap-3',
      )}
    >
      <dt className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {fact.label}
        {fact.info ? <InfoTip label={fact.label} text={fact.info} /> : null}
      </dt>
      <dd className={cn('min-w-0 break-words', layout === 'stack' && 'text-right')}>
        <FactValue fact={fact} />
        {fact.note && hasValue(fact) ? (
          <span className="ml-1 text-muted-foreground">{fact.note}</span>
        ) : null}
      </dd>
    </div>
  );
}

/** WHY: a missing value reads "not captured" alone — its note would turn the line into nonsense. */
function hasValue(fact: Fact): boolean {
  return fact.value !== null && fact.value !== undefined;
}

/** The value: bold tabular, a text-link when it opens a page, muted "not captured" when empty. */
function FactValue({ fact }: { fact: Fact }) {
  if (!hasValue(fact)) {
    return <span className="text-muted-foreground">{NOT_CAPTURED}</span>;
  }
  return (
    <span className="font-semibold text-foreground tabular">
      {fact.href ? (
        <Link href={fact.href} className={cn('text-link', ENTITY_LINK_CLASS)}>
          {fact.value}
        </Link>
      ) : (
        fact.value
      )}
    </span>
  );
}
