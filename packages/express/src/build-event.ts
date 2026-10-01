import { INGEST_HEADERS, INGEST_LIMITS } from '@nexus/shared/constants';
import { createEventId, resolveClientIp, type NexusServerEvent } from '@nexus/node';

import {
  boundedString,
  headerValue,
  optionalBytes,
  optionalErrorCode,
  optionalUuid,
  safely,
  truncatedString,
} from './fields';
import { joinPath, withBasePath } from './path';
import { requestPath } from './skip';
import type { NexusEventKind, NexusRequestLike, NexusResponseLike } from './types';

/** Status recorded when the client hung up before the response finished (nginx convention). */
export const CLIENT_CLOSED_STATUS = 499;
const MAX_IP_LENGTH = 64;

/** When and how the request started. */
export interface RequestStart {
  occurredAt: string;
  hrtime: bigint;
}

/** Resolved middleware settings the builder needs. */
export interface EventSettings<Req extends NexusRequestLike> {
  basePath: string;
  trustProxyHops: number;
  trustIdentityHeader: boolean;
  getUser: (req: Req) => string | null | undefined;
  classify: (req: Req, res: NexusResponseLike) => NexusEventKind;
  getErrorCode: (req: Req, res: NexusResponseLike) => string | null | undefined;
  release: string | undefined;
}

/** Lower-case header name, as Node stores them. */
const header = (name: string): string => name.toLowerCase();

/**
 * `req.baseUrl` + `req.route.path` gives the matched template through nested routers on Express 4
 * and 5. Undefined when nothing matched or the route is a RegExp → the server normalizes the path.
 */
export function routeTemplateOf(req: NexusRequestLike, basePath: string): string | undefined {
  const routePath = (req.route as { path?: unknown } | null | undefined)?.path;
  if (typeof routePath !== 'string') return undefined;
  const template = withBasePath(basePath, joinPath(req.baseUrl, routePath));
  return template.length <= INGEST_LIMITS.maxRouteTemplateLength ? template : undefined;
}

/** Final status: the real one, or 499 when the connection closed before the response finished. */
export function statusOf(res: NexusResponseLike, finished: boolean): number {
  return finished || res.writableFinished ? res.statusCode : CLIENT_CLOSED_STATUS;
}

/** Milliseconds since start, 0.1 ms precision, clamped to the contract range. */
export function durationSince(start: bigint): number {
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return Math.min(Math.max(0, Math.round(ms * 10) / 10), INGEST_LIMITS.maxDurationMs);
}

/** WHY: 'stream' rows (SSE, downloads) must not skew latency percentiles of normal requests. */
export function defaultClassify(_req: NexusRequestLike, res: NexusResponseLike): NexusEventKind {
  const type = String(res.getHeader('content-type') ?? '').toLowerCase();
  const disposition = String(res.getHeader('content-disposition') ?? '').toLowerCase();
  return type.includes('text/event-stream') || disposition.startsWith('attachment') ? 'stream' : 'http';
}

/** The VERIFIED user: getUser first; the X-Nexus-User header ONLY when explicitly trusted. */
function userEmailOf<Req extends NexusRequestLike>(req: Req, settings: EventSettings<Req>): string | undefined {
  const fromApp = boundedString(safely(() => settings.getUser(req)), INGEST_LIMITS.maxEmailLength);
  if (fromApp !== undefined || !settings.trustIdentityHeader) return fromApp;
  return boundedString(headerValue(req.headers[header(INGEST_HEADERS.user)]), INGEST_LIMITS.maxEmailLength);
}

function ipOf(req: NexusRequestLike, trustProxyHops: number): string | undefined {
  const ip = resolveClientIp(req.headers['x-forwarded-for'], req.socket?.remoteAddress, trustProxyHops);
  return ip !== null && ip.length <= MAX_IP_LENGTH ? ip : undefined;
}

/** Remove undefined optional fields so the JSON stays small. */
function compact(event: NexusServerEvent): NexusServerEvent {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as NexusServerEvent;
}

/** WHY: one place that maps a finished request onto the contract's server event (guide chapter 2). */
export function buildServerEvent<Req extends NexusRequestLike>(
  req: Req,
  res: NexusResponseLike,
  start: RequestStart,
  finished: boolean,
  settings: EventSettings<Req>,
): NexusServerEvent {
  const headers = req.headers;
  return compact({
    eventId: createEventId(),
    kind: safely(() => settings.classify(req, res)) === 'stream' ? 'stream' : 'http',
    occurredAt: start.occurredAt,
    method: req.method.toUpperCase(),
    path: withBasePath(settings.basePath, requestPath(req)).slice(0, INGEST_LIMITS.maxWirePathLength),
    routeTemplate: routeTemplateOf(req, settings.basePath),
    status: statusOf(res, finished),
    durationMs: durationSince(start.hrtime),
    ip: ipOf(req, settings.trustProxyHops),
    userEmail: userEmailOf(req, settings),
    requestId: boundedString(headerValue(headers[header(INGEST_HEADERS.requestId)]), INGEST_LIMITS.maxRequestIdLength),
    userAgent: truncatedString(headerValue(headers['user-agent']), INGEST_LIMITS.maxUserAgentWireLength),
    requestBytes: optionalBytes(headerValue(headers['content-length'])),
    responseBytes: optionalBytes(headerValue(res.getHeader('content-length'))),
    errorCode: optionalErrorCode(safely(() => settings.getErrorCode(req, res))),
    release: boundedString(settings.release, INGEST_LIMITS.maxReleaseLength),
    sessionId: optionalUuid(headerValue(headers[header(INGEST_HEADERS.session)])),
    pageViewId: optionalUuid(headerValue(headers[header(INGEST_HEADERS.pageView)])),
  });
}
