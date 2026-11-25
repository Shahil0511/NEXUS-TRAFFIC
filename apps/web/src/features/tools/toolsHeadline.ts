import type { ToolUsageDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { countPhrase, verifiedPeople } from '@/lib/countPhrase';
import { formatInteger } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/**
 * WHY: the features used by the most verified people, most first; features nobody verified used
 * are skipped. Feeds the "Used by the most people: …" part of the Features sentence. Pure; never
 * reorders its input.
 */
export function widestReach(tools: readonly ToolUsageDto[], limit = 1): ToolUsageDto[] {
  return tools
    .filter((tool) => tool.distinctUsers > 0)
    .sort((a, b) => b.distinctUsers - a.distinctUsers)
    .slice(0, limit);
}

/**
 * WHY: the most used feature (the first with the most uses — the API's own order on a tie).
 * Undefined for an empty list. Pure.
 */
export function mostUsedTool(tools: readonly ToolUsageDto[]): ToolUsageDto | undefined {
  return tools.reduce<ToolUsageDto | undefined>(
    (best, tool) => (best === undefined || tool.uses > best.uses ? tool : best),
    undefined,
  );
}

/** A feature's name as a bold link to its own page (carrying the page's filters). */
function toolLinkPart(tool: ToolUsageDto, linkQuery: LinkQuery): SentencePart {
  return {
    text: tool.tool,
    href: withQuery(PAGES.toolDetail(tool.app, tool.toolId), linkQuery),
  };
}

/** " Most used: export-csv (1,250 uses)." */
function mostUsedParts(tool: ToolUsageDto, linkQuery: LinkQuery): SentencePart[] {
  return [
    ' Most used: ',
    toolLinkPart(tool, linkQuery),
    ' (',
    { text: countPhrase(tool.uses, 'use', 'uses') },
    ').',
  ];
}

/**
 * " Used by the most people: export-csv (34 verified people)." — or, when no loaded feature has
 * a verified person, which identities count.
 */
function widestReachParts(items: readonly ToolUsageDto[], linkQuery: LinkQuery): SentencePart[] {
  const [widest] = widestReach(items, 1);
  if (!widest) {
    return [' No verified people yet: only SSO or app-attested identities are counted.'];
  }
  return [
    ' Used by the most people: ',
    toolLinkPart(widest, linkQuery),
    ' (',
    { text: verifiedPeople(widest.distinctUsers) },
    ').',
  ];
}

/**
 * "2 features used 1,550 times in this range." — or, on a capped list (the API's top N by uses),
 * "The 100 most used features were used 9,000 times in this range.", so the counts read as a
 * bound and never as the range's total.
 */
function openingParts(count: number, uses: number, capped: boolean): SentencePart[] {
  const used = { text: countPhrase(uses, 'time', 'times') };
  if (capped) {
    return [
      'The ',
      { text: `${formatInteger(count)} most used features` },
      ' were used ',
      used,
      ' in this range.',
    ];
  }
  return [{ text: countPhrase(count, 'feature', 'features') }, ' used ', used, ' in this range.'];
}

/**
 * WHY: the Features list opens with its numbers in one sentence (PageHeader headline) instead of a
 * chart and a list above the table: how many features were used how often, the most used one and
 * the one used by the most people, each a link to its own page. Counts are over the loaded rows;
 * `capped` (the list reached the API limit) words the opening as a bound. Singulars handled
 * ("1 feature", "1 time", "1 use", "1 verified person"). Pure.
 */
export function toolsHeadline(
  items: readonly ToolUsageDto[],
  linkQuery: LinkQuery,
  capped = false,
): SentencePart[] {
  const mostUsed = mostUsedTool(items);
  if (!mostUsed) return ['No feature was used in this range.'];
  const uses = items.reduce((sum, tool) => sum + tool.uses, 0);
  return [
    ...openingParts(items.length, uses, capped),
    ...mostUsedParts(mostUsed, linkQuery),
    ...widestReachParts(items, linkQuery),
  ];
}
