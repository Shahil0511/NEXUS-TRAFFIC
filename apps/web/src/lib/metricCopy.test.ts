import { describe, expect, it } from 'vitest';

import { COVERAGE_WARN_PCT, METRIC_COPY, metricInfo, type MetricKey } from './metricCopy';

/** Every metric a page shows behind an (i) — adding a metric to a page means adding it here. */
const REQUIRED: readonly MetricKey[] = [
  'onlineNow',
  'requests',
  'errorRate',
  'errors4xx',
  'errors5xx',
  'failedRequests',
  'p50',
  'p95',
  'p99',
  'avgLatency',
  'pageViews',
  'sessions',
  'visibleTime',
  'exitRate',
  'toolUses',
  'identifiedUsers',
  'uniqueUsers',
  'usersAffected',
  'activeUsersNow',
  'dau',
  'wau',
  'mau',
  'identifiedPct',
  'linkedPct',
  'sendingData',
];

describe('METRIC_COPY', () => {
  it('defines every metric the dashboard shows', () => {
    expect(Object.keys(METRIC_COPY)).toEqual(expect.arrayContaining([...REQUIRED]));
  });

  it.each(Object.entries(METRIC_COPY))(
    '%s has a label and full-sentence definitions',
    (_, copy) => {
      expect(copy.label.trim()).not.toBe('');
      expect(copy.short).toMatch(/^\S.*[.!?]$/);
      expect(copy.long).toMatch(/^\S.*[.!?]$/);
      // Tooltips stay readable: a sentence or two, not an essay.
      expect(`${copy.short} ${copy.long}`.length).toBeLessThanOrEqual(260);
    },
  );

  it('explains 4xx versus 5xx under error rate', () => {
    expect(METRIC_COPY.errorRate.long).toMatch(/4xx/);
    expect(METRIC_COPY.errorRate.long).toMatch(/5xx/);
  });

  it('states the coverage threshold on identified % and linked %', () => {
    expect(METRIC_COPY.identifiedPct.long).toContain(`${COVERAGE_WARN_PCT} %`);
    expect(METRIC_COPY.linkedPct.long).toContain(`${COVERAGE_WARN_PCT} %`);
  });
});

describe('metricInfo', () => {
  it('reads the gist first, then the detail', () => {
    expect(metricInfo('p95')).toBe(`${METRIC_COPY.p95.short} ${METRIC_COPY.p95.long}`);
  });
});
