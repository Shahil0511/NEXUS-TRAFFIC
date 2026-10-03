/**
 * Value types attached to a request by middleware (read via http/request-accessors.ts).
 */
import type { ApiKeyRow, AppRow } from './rows';

/** The dashboard user (set by sso-auth.middleware). */
export interface Viewer {
  email: string;
  isAdmin: boolean;
}

/** The authenticated ingest caller (set by server-key-auth / publishable-key-auth middleware). */
export interface AuthenticatedKey {
  app: AppRow;
  key: ApiKeyRow;
}

/** Everything the ingest service needs about the current request besides the payload. */
export interface IngestContext {
  app: AppRow;
  key: ApiKeyRow;
  receivedAt: Date;
  /** Value of the X-Nexus-SDK header or envelope `sdk`, e.g. "@nexus/express@1.0.0". */
  sdk: string | null;
}

/**
 * What a browser beacon reveals about its sender besides the body. Read from the REQUEST (never
 * from the payload): the client IP through TRUST_PROXY_HOPS, the User-Agent header, and the
 * Cookie header (only to verify the SSO `access_token`; NEVER stored or logged).
 */
export interface BrowserRequestInfo {
  ip: string | null;
  userAgent: string | null;
  cookieHeader: string | undefined;
}

/** IngestContext of POST ROUTES.ingest.browser (key = a publishable key). */
export interface BrowserIngestContext extends IngestContext {
  request: BrowserRequestInfo;
}
