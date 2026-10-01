/**
 * User-Agent → browser / OS / device class (ua-parser-js v1, MIT). Truncates input first.
 */
import { notImplemented } from '../lib/not-implemented';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  /** desktop | mobile | tablet | bot | other */
  device: string | null;
}

export class UserAgentParser {
  parse(userAgent: string | null | undefined): ParsedUserAgent {
    void userAgent;
    throw notImplemented('UserAgentParser.parse');
  }
}
