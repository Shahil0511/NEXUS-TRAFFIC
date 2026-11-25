/**
 * Value types attached to a request by middleware (read via http/request-accessors.ts).
 */
import type { ApiKeyRow, AppRow } from './rows';

/** The dashboard user (set by sso-auth.middleware). */
export interface Viewer {
  email: string;
  isAdmin: boolean;
}

/**
 * WHY: the object reads (one page, one feature, one request type) carry lists of people (emails)
 * and single requests with a person; those go to dashboard admins ONLY, while the counts stay for
 * everyone. One pure helper keeps the rule identical in every service: `value` is evaluated
 * (and mapped) only for an admin, everyone else gets null — never an empty list, so the client
 * can tell "hidden" from "none". Pure.
 * @see ../../../../ai-context/decisions/0019-names-on-object-pages-for-admins.md
 */
export function forAdmins<T>(viewer: Viewer, value: () => T): T | null {
  return viewer.isAdmin ? value() : null;
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
  /**
   * The envelope's raw `environment` claim (lenient on the wire, ADR 0008); null when absent.
   * Resolved to a stored Environment by domain/environment.ts resolveEnvironment.
   */
  environmentClaim: string | null;
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
  /**
   * The page origin (`scheme://host[:port]`) from the Origin header, else the ORIGIN of the Referer
   * (origin-guard.middleware.ts requestOrigin). NEVER the referer path. Decides the loopback → dev
   * environment rule and the SSO beacon-origin diagnostic.
   */
  origin: string | null;
}

/** Batch-level fields of the browser envelope that land on every stored row (ADR 0008/0012). */
export interface BrowserEnvelopeInfo {
  /** The frontend build (web_events.release). */
  release?: string;
  /** client.tz / client.lang — validated against CLIENT_TZ_PATTERN / CLIENT_LANG_PATTERN. */
  tz?: string;
  lang?: string;
  /** client.replay: a cross-load retry-queue replay → SSO-cookie identity is skipped. */
  replay: boolean;
}

/** IngestContext of POST ROUTES.ingest.browser (key = a publishable key). */
export interface BrowserIngestContext extends IngestContext {
  request: BrowserRequestInfo;
  envelope: BrowserEnvelopeInfo;
}
