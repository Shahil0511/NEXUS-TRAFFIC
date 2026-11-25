import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { findBannedWords } from '@/lib/neutralCopy';
import { endpointStats } from '@/test/fixtures';

import { endpointHeadline, failedCallsOf, formatFailedShare } from './endpointHeadline';

const ENDPOINT = endpointStats();

/** The sentence as one string (what a reader reads). */
function textOf(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** The bold (object) parts of the sentence. */
function numbersOf(parts: readonly SentencePart[]) {
  return parts.filter((part) => typeof part !== 'string');
}

describe('endpointHeadline', () => {
  it('states calls, people, failures and speed in one sentence', () => {
    const sentence = textOf(endpointHeadline(ENDPOINT, 3));
    expect(sentence).toBe(
      'Called 1,200 times by 3 verified people in this range. 1.3% failed (12 refused, 4xx · 3 server errors, 5xx). Half the calls answer within 80 ms; 95 in 100 within 420 ms.',
    );
    expect(findBannedWords(sentence)).toEqual([]);
  });

  it('makes every number bold and only the failure share red', () => {
    const numbers = numbersOf(endpointHeadline(ENDPOINT, 3));
    expect(numbers.map((part) => (part as { text: string }).text)).toEqual([
      '1,200 times',
      '3 verified people',
      '1.3%',
      '12',
      '3',
      '80 ms',
      '420 ms',
    ]);
    expect(numbers.filter((part) => (part as { tone?: string }).tone === 'destructive')).toEqual([
      { text: '1.3%', tone: 'destructive' },
    ]);
  });

  it('says "Nothing failed." without failures and leaves out the speed without a p50', () => {
    const parts = endpointHeadline(
      { ...ENDPOINT, errors4xx: 0, errors5xx: 0, errorRate: 0, p50Ms: null, p95Ms: null },
      3,
    );
    expect(textOf(parts)).toBe(
      'Called 1,200 times by 3 verified people in this range. Nothing failed.',
    );
    expect(numbersOf(parts).some((part) => (part as { tone?: string }).tone)).toBe(false);
  });

  it('keeps the median when the p95 is missing', () => {
    expect(textOf(endpointHeadline({ ...ENDPOINT, p95Ms: null }, 3))).toContain(
      'Half the calls answer within 80 ms.',
    );
  });

  it('shows a tiny failed share as <0.1%, never 0.0%', () => {
    const sentence = textOf(
      endpointHeadline(
        { ...ENDPOINT, calls: 3000, errors4xx: 1, errors5xx: 0, errorRate: 0.033 },
        3,
      ),
    );
    expect(sentence).toContain('<0.1% failed (1 refused, 4xx · 0 server errors, 5xx).');
    expect(sentence).not.toContain('0.0%');
  });

  it('uses the singular for one call, one person and one server error', () => {
    expect(
      textOf(
        endpointHeadline({ ...ENDPOINT, calls: 1, errors4xx: 0, errors5xx: 1, errorRate: 100 }, 1),
      ),
    ).toBe(
      'Called 1 time by 1 verified person in this range. 100.0% failed (0 refused, 4xx · 1 server error, 5xx). Half the calls answer within 80 ms; 95 in 100 within 420 ms.',
    );
  });
});

describe('formatFailedShare', () => {
  it('never reads 0.0% while a call failed', () => {
    expect(formatFailedShare({ errors4xx: 1, errors5xx: 0, errorRate: 0.033 })).toBe('<0.1%');
    expect(formatFailedShare({ errors4xx: 0, errors5xx: 0, errorRate: 0 })).toBe('0.0%');
    expect(formatFailedShare({ errors4xx: 12, errors5xx: 3, errorRate: 1.25 })).toBe('1.3%');
  });
});

describe('failedCallsOf', () => {
  it('adds the refused (4xx) and server-error (5xx) calls', () => {
    expect(failedCallsOf({ errors4xx: 12, errors5xx: 3 })).toBe(15);
    expect(failedCallsOf({ errors4xx: 0, errors5xx: 0 })).toBe(0);
  });
});
