/**
 * User-Agent → browser / OS / device class (ua-parser-js v1, MIT). Truncates input first.
 * Device: bot (name heuristics, checked first so a "mobile Googlebot" is a bot) → mobile | tablet
 * (parser) → desktop when a browser was recognised → other.
 */
import { INGEST_LIMITS } from '@nexus/shared';
import UAParser from 'ua-parser-js';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  /** desktop | mobile | tablet | bot | other */
  device: string | null;
}

export const DEVICE_CLASSES = {
  desktop: 'desktop',
  mobile: 'mobile',
  tablet: 'tablet',
  bot: 'bot',
  other: 'other',
} as const;

const BOT_PATTERN = /bot|crawl|spider|slurp|headless/i;
const EMPTY: ParsedUserAgent = { browser: null, os: null, device: null };
/**
 * MUST equal the ua_browser / ua_os CHECKs in migrations/0004_api_requests.sql: a crafted UA
 * (`Chrome/<300 digits>`) would otherwise violate them and the event would be rejected.
 */
export const UA_FACET_MAX_LENGTH = 128;

/** "Chrome" + "126.0.1" → "Chrome 126"; name only when the version is unknown. */
function nameWithMajor(name: string | undefined, version: string | undefined): string | null {
  if (!name) return null;
  const major = version?.split('.')[0];
  return (major ? `${name} ${major}` : name).slice(0, UA_FACET_MAX_LENGTH);
}

function deviceClass(input: string, result: UAParser.IResult): string {
  if (BOT_PATTERN.test(input)) return DEVICE_CLASSES.bot;
  if (result.device.type === DEVICE_CLASSES.mobile) return DEVICE_CLASSES.mobile;
  if (result.device.type === DEVICE_CLASSES.tablet) return DEVICE_CLASSES.tablet;
  return result.browser.name ? DEVICE_CLASSES.desktop : DEVICE_CLASSES.other;
}

/** WHY: low-cardinality client facets for the dashboard; the raw UA string is never stored. */
export class UserAgentParser {
  parse(userAgent: string | null | undefined): ParsedUserAgent {
    if (!userAgent) return EMPTY;
    const input = userAgent.slice(0, INGEST_LIMITS.maxUserAgentStoredLength);
    const result = new UAParser(input).getResult();
    return {
      browser: nameWithMajor(result.browser.name, result.browser.version),
      os: nameWithMajor(result.os.name, result.os.version),
      device: deviceClass(input, result),
    };
  }
}
