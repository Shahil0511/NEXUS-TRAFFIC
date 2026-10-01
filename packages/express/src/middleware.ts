import { buildServerEvent, defaultClassify, type EventSettings, type RequestStart } from './build-event';
import { safely } from './fields';
import { normalizeBasePath } from './path';
import { defaultSkip, isContractMethod } from './skip';
import type { NexusMiddleware, NexusMiddlewareOptions, NexusRequestLike, NexusResponseLike } from './types';

const DEFAULT_TRUST_PROXY_HOPS = 1;

/** Default getUser: the common `req.user.email` set by passport-style auth middleware. */
function defaultGetUser(req: NexusRequestLike): string | undefined {
  const email = (req as { user?: { email?: unknown } | null }).user?.email;
  return typeof email === 'string' ? email : undefined;
}

/** Default getErrorCode: `res.locals.errorCode`, set by the app's error handler. */
function defaultGetErrorCode(_req: NexusRequestLike, res: NexusResponseLike): string | undefined {
  const code = res.locals?.['errorCode'];
  return typeof code === 'string' ? code : undefined;
}

function hopsOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_TRUST_PROXY_HOPS;
}

/** True when this request must not be recorded. A throwing skip rule means "skip". */
function shouldSkip<Req extends NexusRequestLike>(req: Req, options: NexusMiddlewareOptions<Req>): boolean {
  if (!isContractMethod(req.method)) return true;
  const base = options.skip ?? defaultSkip;
  return (safely(() => base(req) || (options.extraSkip?.(req) ?? false)) ?? true) === true;
}

/** Resolve options with defaults once, at app start. */
function settingsOf<Req extends NexusRequestLike>(options: NexusMiddlewareOptions<Req>): EventSettings<Req> {
  return {
    basePath: normalizeBasePath(options.basePath),
    trustProxyHops: hopsOf(options.trustProxyHops),
    trustIdentityHeader: options.trustIdentityHeader === true,
    getUser: options.getUser ?? defaultGetUser,
    classify: options.classify ?? defaultClassify,
    getErrorCode: options.getErrorCode ?? defaultGetErrorCode,
    release: options.release,
  };
}

/**
 * Records ONE server event per request and hands it to the Nexus client when the response ends
 * (`finish`) or the client hangs up (`close` → status 499).
 *
 * WHY at the end: status, route template and the signed-in user are only known then. Mount it
 * EARLY (before routers) so the duration covers the whole request. It NEVER throws, NEVER blocks
 * the response and NEVER mutates the request (Express 5's read-only req.query included).
 *
 *   app.use(nexusMiddleware({ client: nexus, basePath: '/my-app', getUser: (req) => req.user?.email }));
 */
export function nexusMiddleware<Req extends NexusRequestLike = NexusRequestLike>(
  options: NexusMiddlewareOptions<Req>,
): NexusMiddleware<Req> {
  const settings = settingsOf(options);
  const client = options.client;

  return function nexusTraffic(req, res, next): void {
    try {
      if (client && !shouldSkip(req, options)) watch(req, res);
    } catch {
      // NEVER break the host app
    }
    next();
  };

  /** Attach the once-only recorder to the response's end events. */
  function watch(req: Req, res: NexusResponseLike): void {
    const start: RequestStart = { occurredAt: new Date().toISOString(), hrtime: process.hrtime.bigint() };
    let recorded = false;
    const record = (finished: boolean): void => {
      if (recorded) return;
      recorded = true;
      safely(() => client.track(buildServerEvent(req, res, start, finished, settings)));
    };
    res.once('finish', () => record(true));
    res.once('close', () => record(false));
  }
}
