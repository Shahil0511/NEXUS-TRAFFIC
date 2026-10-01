/**
 * Typed HTTP errors. Throw them anywhere; `error-handler.middleware.ts` renders the envelope
 * `{ error: { code, message, details?, requestId } }`. Controllers NEVER try/catch.
 * Each class maps to exactly one default code from @nexus/shared ERROR_CODES (overridable for
 * the ingest-specific codes).
 */
import { ERROR_CODES, type ErrorCode } from '@nexus/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.BAD_REQUEST, details?: unknown) {
    super(400, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, code: ErrorCode = ERROR_CODES.VALIDATION_ERROR) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed', code: ErrorCode = ERROR_CODES.FORBIDDEN) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, ERROR_CODES.NOT_FOUND, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, ERROR_CODES.CONFLICT, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported Content-Type') {
    super(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, ERROR_CODES.RATE_LIMITED, 'Too many requests', undefined, {
      'Retry-After': String(retryAfterSeconds),
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable',
    code: ErrorCode = ERROR_CODES.SERVICE_UNAVAILABLE,
    retryAfterSeconds = 5,
  ) {
    super(503, code, message, undefined, { 'Retry-After': String(retryAfterSeconds) });
  }
}
