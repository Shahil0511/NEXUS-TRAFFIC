import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../config';
import {
  allowedSocketOrigins,
  createAllowRequest,
  isAllowedSocketOrigin,
} from './socket-origin.policy';

const ALLOWED = new Set(['https://nexus.libas.in']);

describe('isAllowedSocketOrigin', () => {
  it('allows a missing Origin (same-origin polling, non-browser clients)', () => {
    expect(isAllowedSocketOrigin(undefined, ALLOWED)).toBe(true);
  });

  it('rejects Origin: null (sandboxed iframes, file://)', () => {
    expect(isAllowedSocketOrigin('null', ALLOWED)).toBe(false);
  });

  it('rejects a present but foreign Origin, allows the dashboard origin', () => {
    expect(isAllowedSocketOrigin('https://evil.example', ALLOWED)).toBe(false);
    expect(isAllowedSocketOrigin('https://nexus.libas.in.evil.example', ALLOWED)).toBe(false);
    expect(isAllowedSocketOrigin('', ALLOWED)).toBe(false);
    expect(isAllowedSocketOrigin('https://nexus.libas.in', ALLOWED)).toBe(true);
  });
});

describe('allowedSocketOrigins', () => {
  const config = (isProduction: boolean) =>
    ({
      env: { PUBLIC_ORIGIN: 'https://nexus.libas.in/' },
      isProduction,
      corsDevOrigins: ['http://localhost:3305', 'not a url'],
    }) as unknown as AppConfig;

  it('is PUBLIC_ORIGIN only in production', () => {
    expect([...allowedSocketOrigins(config(true))]).toEqual(['https://nexus.libas.in']);
  });

  it('adds the (valid) dev origins outside production', () => {
    expect([...allowedSocketOrigins(config(false))]).toEqual([
      'https://nexus.libas.in',
      'http://localhost:3305',
    ]);
  });
});

describe('createAllowRequest', () => {
  it('answers the engine.io callback with the decision', () => {
    const allow = createAllowRequest(ALLOWED);
    const decide = (origin: string | undefined) => {
      let result: boolean | undefined;
      allow({ headers: origin === undefined ? {} : { origin } } as IncomingMessage, (_err, ok) => {
        result = ok;
      });
      return result;
    };
    expect(decide(undefined)).toBe(true);
    expect(decide('null')).toBe(false);
    expect(decide('https://evil.example')).toBe(false);
  });
});
