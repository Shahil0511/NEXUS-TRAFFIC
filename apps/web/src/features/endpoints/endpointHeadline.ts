import type { EndpointStatsDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { countPhrase, verifiedPeople } from '@/lib/countPhrase';
import { formatDuration, formatInteger, formatPercent } from '@/lib/format';

/** WHY: a failure is a 4xx (refused) or a 5xx (server error); both count as failed. */
export function failedCallsOf(endpoint: Pick<EndpointStatsDto, 'errors4xx' | 'errors5xx'>): number {
  return endpoint.errors4xx + endpoint.errors5xx;
}

/**
 * WHY: the failed share to one decimal, but never "0.0%" while some call failed (1 in 3,000 would
 * round to zero next to "1 refused"): a share under 0.05% reads "<0.1%". Pure.
 */
export function formatFailedShare(
  endpoint: Pick<EndpointStatsDto, 'errors4xx' | 'errors5xx' | 'errorRate'>,
): string {
  if (failedCallsOf(endpoint) > 0 && endpoint.errorRate < 0.05) return '<0.1%';
  return formatPercent(endpoint.errorRate);
}

/** " 1.3% failed (12 refused, 4xx · 3 server errors, 5xx)." — or " Nothing failed." */
function failureParts(endpoint: EndpointStatsDto): SentencePart[] {
  if (failedCallsOf(endpoint) === 0) return [' Nothing failed.'];
  return [
    ' ',
    { text: formatFailedShare(endpoint), tone: 'destructive' },
    ' failed (',
    { text: formatInteger(endpoint.errors4xx) },
    ' refused, 4xx · ',
    { text: formatInteger(endpoint.errors5xx) },
    ` ${endpoint.errors5xx === 1 ? 'server error' : 'server errors'}, 5xx).`,
  ];
}

/** " Half the calls answer within 80 ms; 95 in 100 within 420 ms." — empty without a p50. */
function speedParts(endpoint: EndpointStatsDto): SentencePart[] {
  if (endpoint.p50Ms === null) return [];
  return [
    ' Half the calls answer within ',
    { text: formatDuration(endpoint.p50Ms) },
    ...(endpoint.p95Ms !== null
      ? ['; 95 in 100 within ', { text: formatDuration(endpoint.p95Ms) }]
      : []),
    '.',
  ];
}

/**
 * WHY: a request type's detail opens with its numbers in one sentence (PageHeader headline)
 * instead of a KPI card row: how often it was called, by how many verified people, how many calls
 * failed (red, split into refused 4xx and server-error 5xx) and how fast it answers (p50 / p95).
 * "Nothing failed." replaces the failure part when every call succeeded; the speed part is left
 * out without a p50 (only streams, or no timed call). Singulars handled ("1 time", "1 verified
 * person", "1 server error"). Pure.
 */
export function endpointHeadline(endpoint: EndpointStatsDto, uniqueUsers: number): SentencePart[] {
  return [
    'Called ',
    { text: countPhrase(endpoint.calls, 'time', 'times') },
    ' by ',
    { text: verifiedPeople(uniqueUsers) },
    ' in this range.',
    ...failureParts(endpoint),
    ...speedParts(endpoint),
  ];
}
