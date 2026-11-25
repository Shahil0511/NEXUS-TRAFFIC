import { describe, expect, it } from 'vitest';

import { appHealth } from '@/test/adminFixtures';

import { HEALTH_MARK_COPY, healthMarkOf } from './healthMark';

describe('healthMarkOf', () => {
  it('passes a healthy app without warnings', () => {
    expect(healthMarkOf(appHealth({ status: 'healthy', warnings: [] }))).toBe('pass');
  });

  it('warns about a stale app or one that never sent', () => {
    expect(healthMarkOf(appHealth({ status: 'stale', warnings: ['stale'] }))).toBe('warn');
    expect(healthMarkOf(appHealth({ status: 'never', warnings: ['never_received'] }))).toBe('warn');
  });

  it('warns about a healthy app with an amber warning', () => {
    expect(healthMarkOf(appHealth({ status: 'healthy', warnings: ['private_ips'] }))).toBe('warn');
  });

  it('fails an app with a red warning, even when it is sending', () => {
    expect(
      healthMarkOf(appHealth({ status: 'healthy', warnings: ['exposed_key', 'private_ips'] })),
    ).toBe('fail');
  });

  it('fails a disabled app', () => {
    expect(healthMarkOf(appHealth({ isActive: false, status: 'healthy', warnings: [] }))).toBe(
      'fail',
    );
  });

  it('has a label for every state', () => {
    expect(HEALTH_MARK_COPY).toEqual({
      pass: 'Healthy',
      warn: 'Needs attention',
      fail: 'Action needed',
    });
  });
});
