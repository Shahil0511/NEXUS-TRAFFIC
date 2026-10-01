import { INGEST_LIMITS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { UA_FACET_MAX_LENGTH, UserAgentParser } from './user-agent.parser';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  googlebotMobile:
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  headless:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
  curl: 'curl/8.4.0',
} as const;

describe('UserAgentParser', () => {
  const parser = new UserAgentParser();

  it('desktop Chrome on Windows', () => {
    expect(parser.parse(UA.chromeWindows)).toEqual({
      browser: 'Chrome 126',
      os: 'Windows 10',
      device: 'desktop',
    });
  });

  it('mobile Safari on iPhone', () => {
    expect(parser.parse(UA.safariIphone)).toMatchObject({
      browser: 'Mobile Safari 17',
      os: 'iOS 17',
      device: 'mobile',
    });
  });

  it('tablet', () => {
    expect(parser.parse(UA.ipad).device).toBe('tablet');
  });

  it.each([UA.googlebotMobile, UA.headless])('bots win over the parsed device: %s', (ua) => {
    expect(parser.parse(ua).device).toBe('bot');
  });

  it('unknown client → other', () => {
    expect(parser.parse(UA.curl)).toMatchObject({ browser: null, device: 'other' });
  });

  it.each([undefined, null, ''])('no user agent (%s) → all null', (ua) => {
    expect(parser.parse(ua)).toEqual({ browser: null, os: null, device: null });
  });

  it('only looks at the first maxUserAgentStoredLength characters', () => {
    const padded = `${UA.chromeWindows}${' '.repeat(INGEST_LIMITS.maxUserAgentStoredLength)} Googlebot`;
    expect(parser.parse(padded).device).toBe('desktop');
  });

  it('clamps browser/os to the DB column length (crafted huge version)', () => {
    const crafted = `Mozilla/5.0 Chrome/${'9'.repeat(300)}.1 Safari/537.36`;
    const browser = parser.parse(crafted).browser ?? '';
    expect(browser.startsWith('Chrome 9')).toBe(true);
    expect(browser).toHaveLength(UA_FACET_MAX_LENGTH);
  });
});
