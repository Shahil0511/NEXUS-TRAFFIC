// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loadWebEnv } from '@/env.schema';

import { dashboardAccessOf } from './dashboardAccessCheck';

/** The two keys without a default, so the explicit source parses (NODE_ENV for the type). */
const REQUIRED = {
  NODE_ENV: 'test' as const,
  LIBAS_JWT_SECRET: 'test-secret',
  PORTAL_LOGIN_URL: 'https://portal.example.test/login',
};

describe('dashboardAccessOf', () => {
  it('is listed when a named list of viewers is set (the email list wins over domains)', () => {
    const env = loadWebEnv({
      ...REQUIRED,
      DASHBOARD_ALLOWED_EMAILS: 'a@libas.in, b@libas.in',
      DASHBOARD_ALLOWED_DOMAINS: 'libas.in',
    });
    expect(dashboardAccessOf(env)).toBe('listed');
  });

  it('is wholeDomain when only the domain list is set (the default libas.in)', () => {
    expect(dashboardAccessOf(loadWebEnv({ ...REQUIRED }))).toBe('wholeDomain');
  });

  it('is adminsOnly when both lists are empty', () => {
    const env = loadWebEnv({
      ...REQUIRED,
      DASHBOARD_ALLOWED_EMAILS: ' ',
      DASHBOARD_ALLOWED_DOMAINS: '',
      DASHBOARD_ADMIN_EMAILS: 'admin@libas.in',
    });
    expect(dashboardAccessOf(env)).toBe('adminsOnly');
  });

  it('is unknown when the env could not be read', () => {
    expect(dashboardAccessOf(null)).toBe('unknown');
  });
});
