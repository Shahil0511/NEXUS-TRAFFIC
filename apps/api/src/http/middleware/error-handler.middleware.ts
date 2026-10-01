/**
 * The ONLY place errors become HTTP responses: `{ error: { code, message, details?, requestId } }`.
 * AppErrors render as-is; body-parser and DB-availability errors are translated; anything else is
 * a 500 with the details logged (never sent to the client).
 *
 * If the response has ALREADY started (headers sent, e.g. a stream failed half-way), no envelope can
 * be written: the error is logged and handed to Express's default handler via next(err), which
 * closes the connection so the client sees a truncated response instead of a hung one.
 */
import { ERROR_CODES, type ApiErrorBody } from '@nexus/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { isUnavailable } from '../../db/pg-errors';
import {
  AppError,
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
} from '../../errors/app-error';
import type { Logger } from '../../lib/logger';

interface BodyParserError {
  type?: string;
  status?: number;
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  const parserError = err as BodyParserError;
  if (parserError?.type === 'entity.too.large') return new PayloadTooLargeError();
  if (parserError?.type === 'entity.parse.failed') return new BadRequestError('Malformed JSON body');
  if (isUnavailable(err)) return new ServiceUnavailableError();
  return null;
}

export function notFoundMiddleware(): RequestHandler {
  return () => {
    throw new NotFoundError('No such route');
  };
}

export function errorHandlerMiddleware(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    const appError = toAppError(err);
    const requestId = res.locals.requestId;
    if (!appError) {
      logger.error('unhandled error', { err, method: req.method, path: req.originalUrl.split('?')[0] });
    } else if (appError.statusCode >= 500) {
      logger.warn('service error', { code: appError.code, err });
    }
    const status = appError?.statusCode ?? 500;
    const body: ApiErrorBody = {
      error: {
        code: appError?.code ?? ERROR_CODES.INTERNAL_ERROR,
        message: appError?.message ?? 'Internal server error',
        ...(appError?.details !== undefined ? { details: appError.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    if (res.headersSent) {
      next(err);
      return;
    }
    for (const [name, value] of Object.entries(appError?.headers ?? {})) res.setHeader(name, value);
    res.status(status).json(body);
  };
}
