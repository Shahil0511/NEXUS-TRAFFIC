import type { ToolUsageDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { findBannedWords } from '@/lib/neutralCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { TOOL_ID, TOOL_USAGE } from '@/test/fixtures';

import { mostUsedTool, toolsHeadline, widestReach } from './toolsHeadline';

const EXPORT: ToolUsageDto = TOOL_USAGE.items[0]!;
const FILTER: ToolUsageDto = {
  ...EXPORT,
  toolId: '2b3c4d5e-6f7a-5b8c-9d0e-1f2a3b4c5d6f',
  tool: 'date-filter',
  uses: 300,
  distinctUsers: 50,
};
const LINK_QUERY = { app: 'ebo-sales' };

/** The sentence as one string (what a reader reads). */
function textOf(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** The linked parts as [text, href] pairs. */
function linksOf(parts: readonly SentencePart[]): [string, string][] {
  return parts.flatMap((part) =>
    typeof part !== 'string' && part.href ? [[part.text, part.href] as [string, string]] : [],
  );
}

describe('toolsHeadline', () => {
  it('states features and uses, names the most used and the widest reach, each a link', () => {
    const parts = toolsHeadline([EXPORT, FILTER], LINK_QUERY);
    expect(textOf(parts)).toBe(
      '2 features used 1,550 times in this range. Most used: export-csv (1,250 uses). Used by the most people: date-filter (50 verified people).',
    );
    expect(linksOf(parts)).toEqual([
      ['export-csv', withQuery(PAGES.toolDetail('ebo-sales', TOOL_ID), LINK_QUERY)],
      ['date-filter', withQuery(PAGES.toolDetail('ebo-sales', FILTER.toolId), LINK_QUERY)],
    ]);
    expect(findBannedWords(textOf(parts))).toEqual([]);
  });

  it('handles singulars', () => {
    expect(textOf(toolsHeadline([{ ...EXPORT, uses: 1, distinctUsers: 1 }], {}))).toBe(
      '1 feature used 1 time in this range. Most used: export-csv (1 use). Used by the most people: export-csv (1 verified person).',
    );
  });

  it('says which identities count when no loaded feature has a verified person', () => {
    expect(textOf(toolsHeadline([{ ...EXPORT, distinctUsers: 0 }], {}))).toBe(
      '1 feature used 1,250 times in this range. Most used: export-csv (1,250 uses). No verified people yet: only SSO or app-attested identities are counted.',
    );
  });

  it('words a capped list (the API limit reached) as a bound, never as the range total', () => {
    const parts = toolsHeadline([EXPORT, FILTER], LINK_QUERY, true);
    expect(textOf(parts)).toBe(
      'The 2 most used features were used 1,550 times in this range. Most used: export-csv (1,250 uses). Used by the most people: date-filter (50 verified people).',
    );
    expect(findBannedWords(textOf(parts))).toEqual([]);
  });

  it('says plainly that nothing was used', () => {
    expect(toolsHeadline([], {})).toEqual(['No feature was used in this range.']);
  });
});

describe('mostUsedTool / widestReach', () => {
  it('picks the most used feature, the first one on a tie', () => {
    expect(mostUsedTool([FILTER, EXPORT])).toBe(EXPORT);
    expect(mostUsedTool([EXPORT, { ...FILTER, uses: EXPORT.uses }])).toBe(EXPORT);
    expect(mostUsedTool([])).toBeUndefined();
  });

  it('picks features with verified people, most first, without reordering the input', () => {
    const items = [EXPORT, FILTER, { ...FILTER, tool: 'none', distinctUsers: 0 }];
    expect(widestReach(items, 5).map((tool) => tool.tool)).toEqual(['date-filter', 'export-csv']);
    expect(items[0]).toBe(EXPORT);
  });
});
