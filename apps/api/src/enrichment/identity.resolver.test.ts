import { describe, expect, it, vi } from 'vitest';

import { fake } from '../../test/ingest-fixtures';
import type { SsoIdentity, SsoIdentityReader } from '../auth/sso-identity.reader';
import { IdentityResolver } from './identity.resolver';

function resolverWith(sso: SsoIdentity) {
  const read = vi.fn((_cookie: string | undefined) => sso);
  return { read, resolver: new IdentityResolver(fake<SsoIdentityReader>({ read })) };
}

const NO_SSO: SsoIdentity = { ok: false, reason: 'missing' };

describe('IdentityResolver.forServer', () => {
  const { resolver } = resolverWith(NO_SSO);

  it('a plausible email is app_attested (normalized)', () => {
    expect(resolver.forServer('  Saurabh@Libas.in ')).toEqual({
      userEmail: 'saurabh@libas.in',
      claimedEmail: null,
      identitySource: 'app_attested',
      dropped: false,
    });
  });

  it('no email → anonymous, nothing dropped', () => {
    expect(resolver.forServer(undefined)).toEqual({
      userEmail: null,
      claimedEmail: null,
      identitySource: 'anonymous',
      dropped: false,
    });
  });

  it.each(['', 'not-an-email', 'a@b', 'two@at@signs.com', 'spa ce@libas.in'])('implausible %j → anonymous, dropped', (email) => {
    expect(resolver.forServer(email)).toMatchObject({ userEmail: null, identitySource: 'anonymous', dropped: true });
  });
});

describe('IdentityResolver.forBrowser', () => {
  it('a valid SSO cookie wins over any hint', () => {
    const { resolver, read } = resolverWith({ ok: true, email: 'saurabh@libas.in', expiresAt: 0 });
    expect(resolver.forBrowser('access_token=x', 'someone@else.com')).toEqual({
      userEmail: 'saurabh@libas.in',
      claimedEmail: null,
      identitySource: 'sso_cookie',
      dropped: false,
    });
    expect(read).toHaveBeenCalledWith('access_token=x');
  });

  it('without SSO a plausible hint is only client_claimed (never user_email)', () => {
    const { resolver } = resolverWith(NO_SSO);
    expect(resolver.forBrowser(undefined, 'Claimed@Libas.in')).toEqual({
      userEmail: null,
      claimedEmail: 'claimed@libas.in',
      identitySource: 'client_claimed',
      dropped: false,
    });
  });

  it('an implausible hint is dropped', () => {
    const { resolver } = resolverWith(NO_SSO);
    expect(resolver.forBrowser(undefined, 'junk')).toMatchObject({ identitySource: 'anonymous', dropped: true });
  });

  it('nothing at all → anonymous', () => {
    const { resolver } = resolverWith(NO_SSO);
    expect(resolver.forBrowser(undefined, undefined)).toMatchObject({ identitySource: 'anonymous', dropped: false });
  });
});
