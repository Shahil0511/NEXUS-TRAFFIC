import { COVERAGE_TARGET_RATIO } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { COVERAGE_WARN_PCT, METRIC_COPY, metricInfo, type MetricKey } from './metricCopy';
import { findBannedWords } from './neutralCopy';

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
  'devices',
  'newDevices',
  'returningDevices',
  'breakdownShare',
  'identityCoverage',
  'linkingCoverage',
  'releaseCoverage',
  'integrationLevel',
  'activeTime',
  'firstActivity',
  'lastActivity',
  'firstActivityInRange',
  'lastActivityInRange',
  'daysActive',
  'dayApps',
  'dayCounts',
  'dayVisits',
  'timeInApp',
  'activityBlock',
  'requestsOutsideBlocks',
  'featureUses',
  'usualActivityHours',
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

  it.each(Object.entries(METRIC_COPY))(
    '%s uses neutral words only (no score, rank or attendance framing, ADR 0017)',
    (_, copy) => {
      expect(
        findBannedWords(`${copy.label}
${copy.short}
${copy.long}`),
      ).toEqual([]);
    },
  );

  it('names the per-person day metrics with the neutral labels', () => {
    expect(METRIC_COPY.activeTime.label).toBe('Tab visible time');
    expect(METRIC_COPY.daysActive.label).toBe('Active days');
    expect(METRIC_COPY.firstActivity.label).toBe('First activity');
    expect(METRIC_COPY.lastActivity.label).toBe('Last activity');
    expect(METRIC_COPY.timeInApp.label).toBe('Time in app');
    expect(METRIC_COPY.timeInApp.short).toMatch(/at the same time count once/);
    expect(METRIC_COPY.featureUses.label).toBe('Feature uses');
    // Tab visible time is screen time of a front tab, not input: the copy says so.
    expect(METRIC_COPY.activeTime.long).toMatch(/not keyboard or mouse use/);
  });

  it('states the per-stretch credit cap wherever tab visible time is defined (ADR 0017)', () => {
    expect(METRIC_COPY.activeTime.long).toMatch(/without a tick\b.* counts at most 1 minute/);
    expect(METRIC_COPY.visibleTime.long).toMatch(/without a tick\b.* counts at most 1 minute/);
  });

  it('explains 4xx versus 5xx under error rate', () => {
    expect(METRIC_COPY.errorRate.long).toMatch(/4xx/);
    expect(METRIC_COPY.errorRate.long).toMatch(/5xx/);
  });

  it('states the coverage threshold on identified % and linked %', () => {
    expect(METRIC_COPY.identifiedPct.long).toContain(`${COVERAGE_WARN_PCT} %`);
    expect(METRIC_COPY.linkedPct.long).toContain(`${COVERAGE_WARN_PCT} %`);
    expect(METRIC_COPY.identityCoverage.long).toContain(`${COVERAGE_WARN_PCT} %`);
    expect(METRIC_COPY.linkingCoverage.long).toContain(`${COVERAGE_WARN_PCT} %`);
  });

  it('uses the API’s coverage target as the warning threshold (one number, ADR 0013)', () => {
    expect(COVERAGE_WARN_PCT).toBe(COVERAGE_TARGET_RATIO * 100);
    expect(COVERAGE_WARN_PCT).toBe(80);
  });

  it('defines linked % on the linkable denominator and identified % as both sources combined', () => {
    expect(METRIC_COPY.linkedPct.short).toMatch(/desktop, mobile and tablet/);
    expect(METRIC_COPY.linkedPct.long).toMatch(/server-to-server/);
    expect(METRIC_COPY.identifiedPct.short).toMatch(/combined/);
    expect(METRIC_COPY.identityCoverage.long).toMatch(/Apps page combines both sources/);
  });

  it('names other pages by their sidebar labels, never by old page names', () => {
    const copy = JSON.stringify(METRIC_COPY);
    expect(copy).not.toMatch(/Users page|Integration page|Integration health|Applications page/);
    expect(METRIC_COPY.identifiedPct.long).toMatch(/People pages\. The Data health page/);
  });
});

describe('metricInfo', () => {
  it('reads the gist first, then the detail', () => {
    expect(metricInfo('p95')).toBe(`${METRIC_COPY.p95.short} ${METRIC_COPY.p95.long}`);
  });
});
