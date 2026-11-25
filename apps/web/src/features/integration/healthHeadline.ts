import { INTEGRATION_HEALTH_WINDOW_MS } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

/**
 * WHY: the window the Data health page covers, in hours (24), as ONE source for both the
 * headline ("events in the last 24 h") and the page description ("Last 24 hours · checked").
 */
export const WINDOW_HOURS = Math.round(INTEGRATION_HEALTH_WINDOW_MS / 3_600_000);

/** Headline counts of the visible apps (built by IntegrationView's tallyHealth). */
export interface HealthTally {
  healthy: number;
  stale: number;
  never: number;
  needsAttention: number;
  /** Apps at the `complete` integration level (computed by the API). */
  complete: number;
}

/**
 * WHY: the Data health page states its five counts in one sentence (PageHeader headline) instead
 * of a KPI card row. Each old card's hint stays in brackets after its number (what healthy, stale
 * and "no events yet" mean, that attention = apps with warnings, what fully integrated takes),
 * and "fully integrated" keeps the integration-level (i). Singular / plural handled; only a
 * non-zero "need attention" is amber. Pure, so the wording is unit-tested.
 */
export function healthHeadline(tally: HealthTally, total: number): SentencePart[] {
  return [
    { text: `${formatInteger(tally.healthy)} of ${formatInteger(total)}` },
    ` ${total === 1 ? 'app' : 'apps'} healthy (events in the last ${WINDOW_HOURS} h). `,
    { text: formatInteger(tally.stale) },
    ' stale (nothing recent), ',
    { text: formatInteger(tally.never) },
    ' with no events yet (registered, never sent). ',
    {
      text: formatInteger(tally.needsAttention),
      ...(tally.needsAttention > 0 ? { tone: 'warning' as const } : {}),
    },
    ` ${tally.needsAttention === 1 ? 'needs' : 'need'} attention (apps with warnings). `,
    {
      text: formatInteger(tally.complete),
      info: { label: 'Fully integrated', text: metricInfo('integrationLevel') },
    },
    ' fully integrated (linked, identified, tagged).',
  ];
}
