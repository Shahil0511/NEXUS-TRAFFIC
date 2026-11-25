import type { ToolUsageDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { findBannedWords } from '@/lib/neutralCopy';
import { TOOL_USAGE } from '@/test/fixtures';

import { toolHeadline } from './toolHeadline';

const TOOL: ToolUsageDto = TOOL_USAGE.items[0]!;
/** Five minutes after the fixture's last use (07:55Z). */
const NOW_MS = new Date('2026-10-01T08:00:00.000Z').getTime();

function textOf(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

describe('toolHeadline', () => {
  it('states uses, people, visits and the last use in one sentence', () => {
    const sentence = textOf(toolHeadline(TOOL, NOW_MS));
    expect(sentence).toBe(
      'Used 1,250 times by 34 verified people in 80 visits in this range. Last used 5 min ago.',
    );
    expect(findBannedWords(sentence)).toEqual([]);
    expect(toolHeadline(TOOL, NOW_MS).filter((part) => typeof part !== 'string')).toHaveLength(4);
  });

  it('uses the singular for one use, one person and one visit', () => {
    expect(
      textOf(toolHeadline({ ...TOOL, uses: 1, distinctUsers: 1, distinctSessions: 1 }, NOW_MS)),
    ).toBe('Used 1 time by 1 verified person in 1 visit in this range. Last used 5 min ago.');
  });
});
