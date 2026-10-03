import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import { LIVE_AUTH_ERROR_MESSAGE, SOCKET_EVENTS } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { recordingLogger } from '../../test/fixtures/recording-logger';
import { signAccessToken } from '../../test/fixtures/sign-access-token';
import { DashboardAccessPolicy } from '../auth/dashboard-access.policy';
import { SsoIdentityReader } from '../auth/sso-identity.reader';
import { FixedClock } from '../lib/clock';
import { LiveSessionSweeper } from './live-session.sweeper';
import type { LiveNamespace, LiveSocket, LiveSocketData } from './live-socket';
import { socketAuthMiddleware } from './socket-auth.middleware';

const SECRET = 'test-jwt-secret-for-socket-auth';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const EXP = NOW.getTime() / 1000 + 3600;

const policy = new DashboardAccessPolicy({
  allowedEmails: [],
  allowedDomains: ['libas.in'],
  adminEmails: ['boss@libas.in'],
});

const cookieFor = (email: string, secret = SECRET, exp = EXP) =>
  `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email, type: 'access', exp }, secret)}`;

function handshake(cookie: string | undefined): {
  socket: LiveSocket;
  data: Partial<LiveSocketData>;
} {
  const data: Partial<LiveSocketData> = {};
  const socket = {
    handshake: { headers: cookie ? { cookie } : {} },
    data,
  } as unknown as LiveSocket;
  return { socket, data };
}

function run(cookie: string | undefined) {
  const { logger, calls } = recordingLogger();
  const middleware = socketAuthMiddleware(
    new SsoIdentityReader(SECRET, new FixedClock(NOW), logger),
    policy,
  );
  const { socket, data } = handshake(cookie);
  const next = vi.fn();
  middleware(socket, next);
  return { next, data, calls };
}

describe('socketAuthMiddleware', () => {
  it('accepts a valid cookie on the policy and stores viewer + expiry on the socket', () => {
    const { next, data } = run(cookieFor('boss@libas.in'));
    expect(next).toHaveBeenCalledWith();
    expect(data).toEqual({
      viewer: { email: 'boss@libas.in', isAdmin: true },
      expiresAtMs: EXP * 1000,
    });
  });

  it('marks non-admins as viewers', () => {
    const { data } = run(cookieFor('amit@libas.in'));
    expect(data.viewer).toEqual({ email: 'amit@libas.in', isAdmin: false });
  });

  it.each([
    ['no cookie', undefined],
    ['a token signed with another secret', cookieFor('boss@libas.in', 'other-secret')],
    ['an expired token', cookieFor('boss@libas.in', SECRET, NOW.getTime() / 1000 - 60)],
    ['an email outside the policy', cookieFor('someone@gmail.com')],
  ])('refuses %s with the generic message only', (_name, cookie) => {
    const { next, data, calls } = run(cookie);
    const err = next.mock.calls[0]?.[0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(LIVE_AUTH_ERROR_MESSAGE);
    expect(data.viewer).toBeUndefined();
    expect(JSON.stringify(calls)).not.toContain('@');
  });
});

describe('LiveSessionSweeper', () => {
  const sweeper = new LiveSessionSweeper(policy);
  const valid: LiveSocketData = {
    viewer: { email: 'boss@libas.in', isAdmin: true },
    expiresAtMs: EXP * 1000,
  };

  it('keeps valid sessions', () => {
    expect(sweeper.endReasonOf(valid, NOW.getTime())).toBeNull();
  });

  it('ends expired tokens and sessions the policy no longer allows (or whose role changed)', () => {
    expect(sweeper.endReasonOf(valid, EXP * 1000)).toBe('expired');
    expect(
      sweeper.endReasonOf({ ...valid, viewer: { email: 'x@gmail.com', isAdmin: false } }, 0),
    ).toBe('revoked');
    expect(
      sweeper.endReasonOf({ ...valid, viewer: { email: 'boss@libas.in', isAdmin: false } }, 0),
    ).toBe('revoked');
    expect(sweeper.endReasonOf({}, 0)).toBe('revoked');
  });

  it('emits live:session-expired before disconnecting, and only for ended sessions', () => {
    const make = (data: LiveSocketData) => ({ data, emit: vi.fn(), disconnect: vi.fn() });
    const keep = make(valid);
    const expire = make({ ...valid, expiresAtMs: NOW.getTime() - 1 });
    const namespace = {
      sockets: new Map([
        ['a', keep],
        ['b', expire],
      ]),
    } as unknown as Pick<LiveNamespace, 'sockets'>;

    expect(sweeper.sweep(namespace, NOW)).toBe(1);
    expect(expire.emit).toHaveBeenCalledWith(SOCKET_EVENTS.sessionExpired, { reason: 'expired' });
    expect(expire.disconnect).toHaveBeenCalledWith(true);
    expect(expire.emit.mock.invocationCallOrder[0]!).toBeLessThan(
      expire.disconnect.mock.invocationCallOrder[0]!,
    );
    expect(keep.emit).not.toHaveBeenCalled();
    expect(keep.disconnect).not.toHaveBeenCalled();
  });
});
