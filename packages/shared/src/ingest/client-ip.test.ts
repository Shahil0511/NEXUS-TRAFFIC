import { describe, expect, it } from 'vitest';

import { buildIngestUrl } from './build-ingest-url';
import { resolveClientIp } from './client-ip';
import { ROUTES } from '../routes';

describe('resolveClientIp (right-to-left hop algorithm)', () => {
  it('gateway → app (1 hop): client is the entry nginx appended', () => {
    expect(resolveClientIp('203.0.113.24', '10.0.0.5', 1)).toBe('203.0.113.24');
  });

  it('ignores a spoofed leftmost entry', () => {
    // client sent "1.1.1.1", nginx appended the real peer 203.0.113.24
    expect(resolveClientIp('1.1.1.1, 203.0.113.24', '10.0.0.5', 1)).toBe('203.0.113.24');
  });

  it('gateway → Next → API (2 hops)', () => {
    expect(resolveClientIp('203.0.113.24, 172.18.0.3', '172.18.0.4', 2)).toBe('203.0.113.24');
  });

  it('0 hops = socket peer; strips ::ffff:', () => {
    expect(resolveClientIp(undefined, '::ffff:192.168.1.9', 0)).toBe('192.168.1.9');
  });

  it('never indexes below the chain start', () => {
    expect(resolveClientIp(undefined, '10.0.0.5', 3)).toBe('10.0.0.5');
    expect(resolveClientIp(undefined, undefined, 1)).toBeNull();
  });

  it('accepts array headers', () => {
    expect(resolveClientIp(['1.1.1.1', '203.0.113.24'], '10.0.0.5', 1)).toBe('203.0.113.24');
  });
});

describe('buildIngestUrl', () => {
  it('joins base + /api + route path without double slashes', () => {
    expect(buildIngestUrl('https://nexus.libas.in/traffic/', ROUTES.ingest.server)).toBe(
      'https://nexus.libas.in/traffic/api/v1/ingest/server',
    );
  });
});
