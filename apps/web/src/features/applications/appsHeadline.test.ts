import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { formatCompact } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { appTraffic } from '@/test/fixtures';

import { appsHeadline, FAILING_ERROR_RATE, totalsOf } from './appsHeadline';

/** The sentence as plain text (what a reader sees, without the info tips). */
const textOf = (parts: readonly SentencePart[]) =>
  parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');

/** The linked or explained parts, in order. */
const numbersOf = (parts: readonly SentencePart[]) =>
  parts.filter((part): part is Exclude<SentencePart, string> => typeof part !== 'string');

const silent = (app: string) =>
  appTraffic({
    app,
    requests: { value: 0, previous: 0, deltaPct: null },
    errorRate: { value: null, previous: null, deltaPct: null },
    lastEventAt: null,
  });
const failing = (app: string) =>
  appTraffic({ app, errorRate: { value: FAILING_ERROR_RATE, previous: 1, deltaPct: 400 } });

describe('appsHeadline', () => {
  it('says there is nothing yet with no app, but keeps every link and info tip', () => {
    const parts = appsHeadline([], { range: '7d' });
    expect(textOf(parts)).toBe(
      `No apps registered yet. 0 of 0 sent data in this range. ${formatCompact(0)} API calls in total. No app with an error rate of 5 % or more.`,
    );
    const [sending, calls, errors] = numbersOf(parts);
    expect([sending?.href, calls?.href, errors?.href]).toEqual([
      '/integration',
      '/endpoints?range=7d',
      '/errors?range=7d',
    ]);
    expect([sending?.info?.label, calls?.info?.label, errors?.info?.label]).toEqual([
      'Sending data',
      'API calls',
      `Error rate ≥ ${FAILING_ERROR_RATE} %`,
    ]);
    expect(errors?.tone).toBeUndefined();
  });

  it('speaks of one app in the singular', () => {
    const parts = appsHeadline([appTraffic()], {});
    expect(textOf(parts)).toBe(
      `1 app registered. 1 of 1 sent data in this range. ${formatCompact(9_000)} API calls in total. No app with an error rate of 5 % or more.`,
    );
  });

  it('counts apps that sent data, sums API calls and keeps the failing count neutral at zero', () => {
    const parts = appsHeadline([appTraffic(), silent('hr-portal')], {});
    expect(textOf(parts)).toContain('2 apps registered. 1 of 2 sent data in this range.');
    const [, , errors] = numbersOf(parts);
    expect(errors?.text).toBe('No app');
    expect(errors?.tone).toBeUndefined();
  });

  it('colours the failing count red when apps fail at 5 % or more', () => {
    const parts = appsHeadline([failing('a'), failing('b'), appTraffic()], {});
    const [, , errors] = numbersOf(parts);
    expect(errors?.text).toBe('2 apps');
    expect(errors?.tone).toBe('destructive');
  });

  it('links each number to its page with the filters (Data health has none) and explains it', () => {
    const [sending, calls, errors] = numbersOf(
      appsHeadline([appTraffic()], { range: '7d', env: 'staging', app: undefined }),
    );
    expect(sending?.href).toBe('/integration');
    expect(calls?.href).toBe('/endpoints?range=7d&env=staging');
    expect(errors?.href).toBe('/errors?range=7d&env=staging');
    expect(sending?.info?.text).toBe(metricInfo('sendingData'));
    expect(calls?.info?.text).toBe(metricInfo('requests'));
    expect(errors?.info?.text).toContain(metricInfo('errorRate'));
  });
});

describe('totalsOf', () => {
  it('does not count a silent app as active and treats a missing value as zero', () => {
    expect(totalsOf([appTraffic(), silent('hr-portal')])).toEqual({
      active: 1,
      requests: 9_000,
      failing: 0,
    });
  });
});
