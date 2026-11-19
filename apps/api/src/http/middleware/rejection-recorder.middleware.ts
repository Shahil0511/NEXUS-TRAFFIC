/**
 * Records ENVELOPE-level refusals of an authenticated app in traffic.ingest_rejections (A9):
 * server INVALID_ENVELOPE (validateBody runs after serverKeyAuth) and browser ORIGIN_NOT_ALLOWED
 * (originGuard runs after publishableKeyAuth). Per-event rejections are recorded by IngestService.
 *
 * Mounted ONLY on POST ROUTES.ingest.server (right after serverKeyAuth) and POST
 * ROUTES.ingest.browser (right after publishableKeyAuth) — config-route failures are NEVER
 * recorded. On `finish` it records when: status ≥ 400, the app is known (res.locals.ingest), and
 * res.locals.errorCode (set by errorHandlerMiddleware) is one of RECORDED_ENVELOPE_CODES.
 * The row holds the code only: schema_path '' and, for ORIGIN_NOT_ALLOWED, sdk '' (only a PUBLIC
 * key is proven there, so sender-chosen text must not create rows). For server INVALID_ENVELOPE the
 * sdk is the X-Nexus-SDK header, else the raw body's `sdk {name, version}` (the FastAPI client sends
 * no header) — strictly normalised. Failures are logged, never thrown.
 * @see ../../repositories/ingest-rejection.repository.ts IngestRejectionRepository.increment
 */
import {
  ERROR_CODES,
  INGEST_HEADERS,
  type ErrorCode,
  type IngestRejectionCode,
  type IngestSource,
} from '@nexus/shared';
import type { Request, RequestHandler, Response } from 'express';

import { NO_SCHEMA_PATH } from '../../domain/schema-path';
import { NO_SDK_LABEL, normalizeSdkLabel } from '../../domain/sdk-label';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import type { IngestRejectionRepository } from '../../repositories/ingest-rejection.repository';

/** The envelope-level codes worth recording (both happen after the app is authenticated). */
export const RECORDED_ENVELOPE_CODES: readonly IngestRejectionCode[] = [
  ERROR_CODES.INVALID_ENVELOPE,
  ERROR_CODES.ORIGIN_NOT_ALLOWED,
];

const HTTP_ERROR_MIN = 400;

function recordedCode(errorCode: ErrorCode | undefined): IngestRejectionCode | null {
  return errorCode !== undefined && (RECORDED_ENVELOPE_CODES as readonly ErrorCode[]).includes(errorCode)
    ? (errorCode as IngestRejectionCode)
    : null;
}

/**
 * The sender's SDK label of a refused SERVER envelope: the X-Nexus-SDK header, else the body's
 * `sdk {name, version}` when both are strings (the body failed validation, so it is read raw).
 * Browser rows never need it: their only recorded code (ORIGIN_NOT_ALLOWED) always stores sdk ''.
 */
function sdkOf(req: Request): string | null {
  const header = req.get(INGEST_HEADERS.sdk);
  if (header) return header;
  const body: unknown = req.body;
  if (body === null || typeof body !== 'object') return null;
  const sdk = (body as { sdk?: unknown }).sdk;
  if (sdk === null || typeof sdk !== 'object') return null;
  const { name, version } = sdk as Record<string, unknown>;
  return typeof name === 'string' && typeof version === 'string' ? `${name}@${version}` : null;
}

/** WHY: "why are my events refused?" must include refusals that never reach IngestService. */
export function rejectionRecorderMiddleware(
  rejections: IngestRejectionRepository,
  source: IngestSource,
  clock: Clock,
  logger: Logger,
): RequestHandler {
  const record = (req: Request, res: Response): void => {
    if (res.statusCode < HTTP_ERROR_MIN) return;
    const app = res.locals.ingest?.app;
    const code = recordedCode(res.locals.errorCode);
    if (!app || !code) return;
    const sdk = code === ERROR_CODES.ORIGIN_NOT_ALLOWED ? NO_SDK_LABEL : normalizeSdkLabel(sdkOf(req));
    rejections
      .increment(app.id, [{ source, sdk, code, schemaPath: NO_SCHEMA_PATH, rejected: 1 }], clock.now())
      .catch((err: unknown) => logger.warn('ingest rejection counter update failed', { err, appId: app.id }));
  };
  return (req, res, next) => {
    res.on('finish', () => record(req, res));
    next();
  };
}
