import { describe, expect, it } from 'vitest';

import { appHealth } from '@/test/adminFixtures';

import { appCheckSummary, firstFix } from './appCheckSummary';

describe('appCheckSummary', () => {
  it('names the first warning when there are warnings', () => {
    expect(appCheckSummary(appHealth())).toBe('Secret key exposed');
    expect(appCheckSummary(appHealth({ warnings: ['stale', 'clock_skew'] }))).toBe(
      'No recent events',
    );
  });

  it('says Sending, the best identified share and the browser add-on version when all is well', () => {
    const health = appHealth({
      warnings: [],
      sdks: [
        { ...appHealth().sdks[0]!, version: '1.2.0' },
        { ...appHealth().sdks[1]!, version: '1.1.0' },
      ],
    });
    expect(appCheckSummary(health)).toBe('Sending · people identified 95% · add-on 1.1.0');
  });

  it('falls back to the server add-on and skips unknown facts', () => {
    const serverOnly = appHealth({ warnings: [], sdks: [appHealth().sdks[0]!] });
    expect(appCheckSummary(serverOnly)).toBe('Sending · people identified 95% · add-on 1.0.0');

    const nothingKnown = appHealth({
      warnings: [],
      sdks: [],
      identityCoverage: [
        { source: 'server', events: 3, covered: 0, ratio: null },
        { source: 'browser', events: 0, covered: 0, ratio: null },
      ],
    });
    expect(appCheckSummary(nothingKnown)).toBe('Sending');
  });

  it('uses the status label when the app is not healthy and has no warning', () => {
    expect(appCheckSummary(appHealth({ warnings: [], status: 'stale', sdks: [] }))).toBe(
      'Stale · people identified 95%',
    );
  });
});

describe('firstFix', () => {
  it('is the chapter and title of the first warning, or null without warnings', () => {
    expect(firstFix(appHealth())).toEqual({ chapter: 'keys', warningTitle: 'Secret key exposed' });
    expect(firstFix(appHealth({ warnings: ['private_ips'] }))).toEqual({
      chapter: 'clientIp',
      warningTitle: 'Proxy IPs instead of users',
    });
    expect(firstFix(appHealth({ warnings: [] }))).toBeNull();
  });
});
