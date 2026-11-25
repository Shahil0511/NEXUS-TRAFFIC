import type { AppTrafficDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { formatCompact, formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';

import { isSilent } from './appTrafficColumns';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/** Error rate (%) from which an app counts as "needs attention" in the headline. */
export const FAILING_ERROR_RATE = 5;

/**
 * WHY: the totals the Apps headline states. Users are NOT summed: one person uses several apps,
 * so a sum would count them twice.
 */
export function totalsOf(items: readonly AppTrafficDto[]) {
  return {
    active: items.filter((item) => !isSilent(item)).length,
    requests: items.reduce((sum, item) => sum + (item.requests.value ?? 0), 0),
    failing: items.filter((item) => (item.errorRate.value ?? 0) >= FAILING_ERROR_RATE).length,
  };
}

/** "No app" / "1 app" / "3 apps" — the error-rate count reads as a phrase, not a bare digit. */
function appCount(count: number): string {
  if (count === 0) return 'No app';
  return `${formatInteger(count)} ${count === 1 ? 'app' : 'apps'}`;
}

/**
 * "No apps registered yet. " / "1 app registered. " / "3 apps registered. ". With no apps the rest
 * of the sentence still follows (0 of 0, 0 API calls), so its links and info tips stay reachable.
 */
function registeredPhrase(count: number): string {
  if (count === 0) return 'No apps registered yet. ';
  return `${formatInteger(count)} ${count === 1 ? 'app' : 'apps'} registered. `;
}

/**
 * WHY: the Apps page states its four totals in one sentence (PageHeader headline) instead of a
 * KPI card row: apps registered, how many sent data (opens Data health), API calls in total (opens
 * Request types) and how many apps failed often (opens Problems, red only when there are some).
 * Every number keeps its definition behind an (i) (lib/metricCopy). The links carry the page's
 * filters, as the cards did; Data health has no range, so it gets none.
 * The full sentence is kept with no apps too (nothing is lost on an empty install).
 */
export function appsHeadline(
  items: readonly AppTrafficDto[],
  linkQuery: LinkQuery,
): SentencePart[] {
  const registered = items.length;
  const totals = totalsOf(items);
  return [
    registeredPhrase(registered),
    {
      text: `${formatInteger(totals.active)} of ${formatInteger(registered)}`,
      href: withQuery(PAGES.integration(), {}),
      info: { label: 'Sending data', text: metricInfo('sendingData') },
    },
    ' sent data in this range. ',
    {
      text: formatCompact(totals.requests),
      href: withQuery(PAGES.endpoints(), linkQuery),
      info: { label: 'API calls', text: metricInfo('requests') },
    },
    ' API calls in total. ',
    {
      text: appCount(totals.failing),
      href: withQuery(PAGES.errors(), linkQuery),
      ...(totals.failing > 0 ? { tone: 'destructive' as const } : {}),
      info: {
        label: `Error rate ≥ ${FAILING_ERROR_RATE} %`,
        text: `Apps where ${FAILING_ERROR_RATE} % or more of the API calls failed in this range. ${metricInfo('errorRate')}`,
      },
    },
    ` with an error rate of ${FAILING_ERROR_RATE} % or more.`,
  ];
}
