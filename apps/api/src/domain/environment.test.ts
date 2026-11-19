import { describe, expect, it } from 'vitest';

import { isLoopbackHost, resolveEnvironment } from './environment';

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', 'printer.local', '127.0.0.1', '127.8.9.10', '[::1]'])(
    '%s is loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['ebo.libas.in', 'localhost.libas.in', 'local', '128.0.0.1', '10.0.0.1', '[::2]', 'mylocal'])(
    '%s is not loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe('resolveEnvironment', () => {
  it.each([
    // [claim, origin, source, environment, droppedClaim]
    [null, null, 'server', 'prod', false],
    ['staging', null, 'server', 'staging', false],
    ['dev', null, 'server', 'dev', false],
    ['production', null, 'server', 'prod', true],
    ['PROD', null, 'server', 'prod', true],
    // Server: the origin is never consulted (no IP/host heuristic).
    ['prod', 'http://localhost:3000', 'server', 'prod', false],
    [null, 'https://ebo.libas.in', 'browser', 'prod', false],
    ['staging', 'https://staging.libas.in', 'browser', 'staging', false],
    // A loopback page origin overrides even a prod claim.
    ['prod', 'http://localhost:3000', 'browser', 'dev', false],
    [null, 'http://127.0.0.1:5173', 'browser', 'dev', false],
    ['qa', 'http://[::1]:8080', 'browser', 'dev', true],
    ['staging', 'http://shop.local', 'browser', 'dev', false],
    [null, 'not a url', 'browser', 'prod', false],
  ] as const)('claim %s, origin %s, %s → %s', (claim, origin, source, environment, droppedClaim) => {
    expect(resolveEnvironment(claim, origin, source)).toEqual({ environment, droppedClaim });
  });
});
