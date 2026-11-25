import type { ToolUsageDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { countPhrase, verifiedPeople } from '@/lib/countPhrase';
import { EMPTY_VALUE, formatAgo } from '@/lib/format';

/**
 * WHY: a feature's detail opens with its numbers in one sentence (PageHeader headline) instead of
 * a KPI card row: how often it was used, by how many verified people, in how many visits, and how
 * long ago it was last used. `nowMs` is passed in so the sentence is unit-tested. Singulars handled
 * ("1 time", "1 verified person", "1 visit"). Pure.
 */
export function toolHeadline(tool: ToolUsageDto, nowMs: number): SentencePart[] {
  return [
    'Used ',
    { text: countPhrase(tool.uses, 'time', 'times') },
    ' by ',
    { text: verifiedPeople(tool.distinctUsers) },
    ' in ',
    { text: countPhrase(tool.distinctSessions, 'visit', 'visits') },
    ' in this range. Last used ',
    { text: formatAgo(tool.lastUsedAt, nowMs) ?? EMPTY_VALUE },
    '.',
  ];
}
