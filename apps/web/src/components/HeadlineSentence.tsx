import Link from 'next/link';
import { Fragment } from 'react';

import { ENTITY_LINK_CLASS } from '@/components/EntityLinks';
import { InfoTip } from '@/components/InfoTip';
import { cn } from '@/lib/utils';

/** Status colour of a number in the sentence (status meaning only, never decoration). */
export type SentenceTone = 'destructive' | 'warning' | 'success';

/**
 * One piece of a headline sentence: plain words, or a number (bold) that may open a page
 * (`href`, built from PAGES), carry a status colour (`tone`) and explain itself (`info`, an (i)).
 */
export type SentencePart =
  | string
  | {
      text: string;
      href?: string;
      tone?: SentenceTone;
      info?: { label: string; text: string };
    };

const TONE_CLASS: Record<SentenceTone, string> = {
  destructive: 'text-destructive',
  warning: 'text-warning',
  success: 'text-success',
};

/**
 * WHY: pages show their numbers in a sentence, not a KPI card row — a sentence reads in one go
 * and says how the numbers relate. Pure builders (e.g. features/applications/appsHeadline.ts)
 * return SentencePart[] so the wording is unit-tested without rendering; this component only
 * draws it. The (i) sits BESIDE the link, never inside it (InfoTip is a button).
 */
export function HeadlineSentence({
  parts,
  className,
}: {
  parts: readonly SentencePart[];
  className?: string;
}) {
  return (
    <p
      className={cn(
        'max-w-4xl font-heading text-lg leading-snug text-foreground sm:text-xl',
        className,
      )}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          <SentencePiece part={part} />
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Link style of a toned number: it keeps its status colour on hover and focus too (red stays red),
 * so it skips ENTITY_LINK_CLASS (whose hover/focus turn text-link) and spells out the same focus
 * ring; the permanent underline, not the colour, marks it as a link.
 */
const TONED_LINK_CLASS =
  'rounded-sm underline decoration-1 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

/** Link style of an untoned number: the entity link look, violet (text-link) at rest. */
const PLAIN_LINK_CLASS = `text-link ${ENTITY_LINK_CLASS}`;

/**
 * One part: text as is; a number bold, optionally linked, toned and explained. A toned link keeps
 * its status colour (TONED_LINK_CLASS); an untoned one is text-link (PLAIN_LINK_CLASS). Classes
 * are joined, not merged: tailwind-merge would read text-link and the status colours as one group
 * and drop one.
 */
function SentencePiece({ part }: { part: SentencePart }) {
  if (typeof part === 'string') return part;
  const toneClass = part.tone ? TONE_CLASS[part.tone] : undefined;
  return (
    <>
      <strong className={['font-semibold tabular', toneClass].filter(Boolean).join(' ')}>
        {part.href ? (
          <Link href={part.href} className={toneClass ? TONED_LINK_CLASS : PLAIN_LINK_CLASS}>
            {part.text}
          </Link>
        ) : (
          part.text
        )}
      </strong>
      {part.info ? (
        <InfoTip label={part.info.label} text={part.info.text} className="ml-1 align-middle" />
      ) : null}
    </>
  );
}
