import type { IncomingHttpHeaders } from 'node:http';

import type { NexusClient } from '@nexus/node';

/**
 * The parts of an Express 4/5 request the middleware reads.
 *
 * WHY structural types instead of `import('express')`: the package then works with Express 4 and 5
 * typings alike (and with none installed), and the published .d.ts has no dependency on them.
 */
export interface NexusRequestLike {
  method: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  route?: unknown;
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string | undefined } | null;
}

/** The parts of an Express 4/5 response the middleware reads. */
export interface NexusResponseLike {
  statusCode: number;
  writableFinished?: boolean;
  getHeader(name: string): number | string | string[] | undefined;
  once(event: 'finish' | 'close', listener: () => void): unknown;
  locals?: Record<string, unknown>;
}

export type NexusEventKind = 'http' | 'stream';

export interface NexusMiddlewareOptions<Req extends NexusRequestLike = NexusRequestLike> {
  /** The client from createNexusClient(). */
  client: NexusClient;
  /** Public prefix your gateway strips before Express sees the request ('' if none), e.g. '/ebo-sales'. */
  basePath?: string;
  /** Your VERIFIED signed-in user's email, read when the response ends. Default `req.user?.email`. */
  getUser?: (req: Req) => string | null | undefined;
  /** Proxies YOU run in front of this app: gateway → app = 1 (default); gateway → Next → app = 2. */
  trustProxyHops?: number;
  /** Replaces the default skip rule (OPTIONS, health checks, static assets). Return true to skip. */
  skip?: (req: Req) => boolean;
  /** Extra skip rule applied ON TOP of the default (or of `skip`). */
  extraSkip?: (req: Req) => boolean;
  /** Overrides the http/stream auto-detection (text/event-stream or a download → 'stream'). */
  classify?: (req: Req, res: NexusResponseLike) => NexusEventKind;
  /**
   * Read the email from the `X-Nexus-User` header when getUser has none. ONLY enable it when a
   * gateway you control OVERWRITES that header — otherwise any client can forge an identity.
   */
  trustIdentityHeader?: boolean;
  /** Your app's error CODE for this response (never a message). Default `res.locals.errorCode`. */
  getErrorCode?: (req: Req, res: NexusResponseLike) => string | null | undefined;
  /** Your release/version label, e.g. a git sha. */
  release?: string;
}

/** An Express-compatible middleware function. */
export type NexusMiddleware<Req extends NexusRequestLike = NexusRequestLike> = (
  req: Req,
  res: NexusResponseLike,
  next: (error?: unknown) => void,
) => void;
