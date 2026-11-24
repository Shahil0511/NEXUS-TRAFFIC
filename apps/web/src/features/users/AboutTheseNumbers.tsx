import { Info } from 'lucide-react';

import { Panel } from '@/components/Panel';

/** Which view the caveats sit under: the list of days, or one day (its own lines added there). */
export type AboutTheseNumbersVariant = 'days' | 'day';

/** Lines true of every per-day view of one person. */
const COMMON_LINES = [
  'Days and hours are India time (IST).',
  'Tab visible time is how long an app page was on screen in a front tab. It is not keyboard or mouse use: a tab left open on screen keeps counting.',
  'Two visible windows or tabs both count in Tab visible time.',
  'One stretch without a tick (for example a sleeping laptop) counts at most 1 minute.',
  'Apps that send only server calls (no browser tracker) move first and last activity but add no time.',
  'Only signed-in (verified) activity is shown. If a login is shared, this activity may belong to several people.',
  'First and last activity are recorded events, not sign-in or sign-out times.',
  'Raw activity is kept for about 6 months.',
] as const;

/** Extra lines of the one-day view. */
const DAY_LINES = [
  'Time in app counts tabs that were open at the same time once, so it can be lower than Tab visible time.',
] as const;

/** The lines shown for a variant, in reading order. Pure. */
export function aboutTheseNumbersLines(variant: AboutTheseNumbersVariant): readonly string[] {
  return variant === 'day' ? [...COMMON_LINES, ...DAY_LINES] : COMMON_LINES;
}

/**
 * WHY: per-person, per-day numbers are easy to over-read: screen time is not input, a shared login
 * mixes people, and first / last activity are not sign-in times. The limits are stated on the
 * screen itself, at the bottom of every per-day view, in plain sentences (ADR 0017). Static text,
 * no data and no request.
 */
export function AboutTheseNumbers({ variant }: { variant: AboutTheseNumbersVariant }) {
  return (
    <Panel title="About these numbers" icon={Info}>
      <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
        {aboutTheseNumbersLines(variant).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Panel>
  );
}
