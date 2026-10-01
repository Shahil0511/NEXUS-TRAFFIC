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
