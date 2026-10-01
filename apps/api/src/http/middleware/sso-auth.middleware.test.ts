import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import { ERROR_CODES } from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { signAccessToken } from '../../../test/fixtures/sign-access-token';
import { DashboardAccessPolicy } from '../../auth/dashboard-access.policy';
import { SsoIdentityReader } from '../../auth/sso-identity.reader';
import { FixedClock } from '../../lib/clock';
import { requireViewer } from '../request-accessors';
import { errorHandlerMiddleware } from './error-handler.middleware';
import { ssoAuthMiddleware } from './sso-auth.middleware';

const SECRET = 'test-jwt-secret-for-sso-middleware';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const EXP = NOW.getTime() / 1000 + 3600;

function buildApp(): Express {
  const { logger } = recordingLogger();
  const reader = new SsoIdentityReader(SECRET, new FixedClock(NOW), logger);
  const policy = new DashboardAccessPolicy({
    allowedEmails: [],
    allowedDomains: ['libas.in'],
    adminEmails: ['boss@libas.in'],
  });
  const app = express();
  app.get('/probe', ssoAuthMiddleware(reader, policy), (_req, res) => {
    res.json(requireViewer(res));
  });
  app.use(errorHandlerMiddleware(logger));
  return app;
}

const cookieFor = (email: string, secret = SECRET) =>
  `other=1; ${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email, type: 'access', exp: EXP }, secret)}`;

describe('ssoAuthMiddleware', () => {
  const app = buildApp();

  it('401 with the error envelope when there is no cookie', async () => {
    const res = await request(app).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: ERROR_CODES.UNAUTHORIZED, message: expect.any(String) },
    });
  });

  it('401 for a token signed with another secret', async () => {
    const res = await request(app)
      .get('/probe')
      .set('Cookie', cookieFor('a@libas.in', 'wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('sets the viewer for a valid token of an allowed user', async () => {
    const res = await request(app).get('/probe').set('Cookie', cookieFor('Someone@Libas.in'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'someone@libas.in', isAdmin: false });
  });

  it('flags admins', async () => {
    const res = await request(app).get('/probe').set('Cookie', cookieFor('boss@libas.in'));
    expect(res.body).toEqual({ email: 'boss@libas.in', isAdmin: true });
  });

  it('403 for a valid token of a user outside the policy', async () => {
    const res = await request(app).get('/probe').set('Cookie', cookieFor('stranger@gmail.com'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
