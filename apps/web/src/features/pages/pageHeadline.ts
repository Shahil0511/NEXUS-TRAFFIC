import type { PageStatsDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { countPhrase, verifiedPeople } from '@/lib/countPhrase';
import { formatDuration, formatPercent } from '@/lib/format';

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

/** WHY: share of a page's visits that ended on it (%); null when there were no visits. */
export function exitRateOf(page: Pick<PageStatsDto, 'exits' | 'uniqueSessions'>): number | null {
  return page.uniqueSessions > 0 ? (page.exits / page.uniqueSessions) * PERCENT : null;
}

/**
 * A rough length for "about …": whole seconds under a minute ("48 s", not "48.00 s"); the usual
 * duration format below a second and from a minute ("350 ms", "1m 40s"). Rounds to whole seconds
 * BEFORE choosing, so 59.6 s reads "1m 0s" (never "60 s") and the minute formats meet at 60 s.
 */
function aboutDuration(ms: number): string {
  if (Math.round(ms) < MS_PER_SECOND) return formatDuration(ms);
  const seconds = Math.round(ms / MS_PER_SECOND);
  const rounded = seconds * MS_PER_SECOND;
  return rounded < MS_PER_MINUTE ? `${seconds} s` : formatDuration(rounded);
}

/** " People look at it for about 48 s (median 31 s)." — empty without a visible time. */
function visibleTimeParts(page: PageStatsDto): SentencePart[] {
  if (page.avgVisibleMs === null) return [];
  return [
    ' People look at it for about ',
    { text: aboutDuration(page.avgVisibleMs) },
    ...(page.p50VisibleMs !== null
      ? [' (median ', { text: aboutDuration(page.p50VisibleMs) }, ')']
      : []),
    '.',
  ];
}

/** " 25.0% of visits end here." — empty when no visit ended on the page. */
function exitParts(page: PageStatsDto): SentencePart[] {
  const rate = exitRateOf(page);
  if (rate === null || page.exits === 0) return [];
  return [' ', { text: formatPercent(rate) }, ' of visits end here.'];
}

/**
 * WHY: a page's detail opens with its numbers in one sentence (PageHeader headline) instead of a
 * KPI card row: how often it was viewed, by how many verified people, in how many visits, how long
 * people look at it and how many visits end there. The time and exit parts are left out when there
 * is nothing to say. Singulars handled ("1 time", "1 verified person", "1 visit"). Pure.
 */
export function pageHeadline(page: PageStatsDto): SentencePart[] {
  return [
    'Viewed ',
    { text: countPhrase(page.views, 'time', 'times') },
    ' by ',
    { text: verifiedPeople(page.distinctUsers) },
    ' in ',
    { text: countPhrase(page.uniqueSessions, 'visit', 'visits') },
    ' in this range.',
    ...visibleTimeParts(page),
    ...exitParts(page),
  ];
}
