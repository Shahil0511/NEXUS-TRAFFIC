/**
 * Error codes of the API, shared by server, dashboard and SDK docs.
 *
 * WHY: every AppError subclass in apps/api maps to exactly one code here, the dashboard switches on
 * them, and the published guide's response table (docs/integration/04-responses-retries.md) lists
 * them. Codes are UPPER_SNAKE and stable — clients may branch on them; messages may change.
 */

export const ERROR_CODES = {
  // ─── Generic HTTP ─────────────────────────────────────────────────────────
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // ─── Ingest: whole request ────────────────────────────────────────────────
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_API_KEY: 'INVALID_API_KEY',
  WRONG_KEY_TYPE: 'WRONG_KEY_TYPE',
  SECRET_KEY_EXPOSED: 'SECRET_KEY_EXPOSED',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  APP_DISABLED: 'APP_DISABLED',
  BROWSER_INGEST_DISABLED: 'BROWSER_INGEST_DISABLED',
  INGEST_UNAVAILABLE: 'INGEST_UNAVAILABLE',

  // ─── Ingest: single event (listed in the 202 body's `rejected[]`) ─────────
  INVALID_EVENT: 'INVALID_EVENT',
  EVENT_TIME_OUT_OF_RANGE: 'EVENT_TIME_OUT_OF_RANGE',
  PATH_OUTSIDE_APP: 'PATH_OUTSIDE_APP',
  DB_CONSTRAINT: 'DB_CONSTRAINT',

  // ─── Ingest: warnings (listed in `warnings[]`; the event is still stored) ─
  FIELD_DROPPED: 'FIELD_DROPPED',
  FIELD_TRUNCATED: 'FIELD_TRUNCATED',

  // ─── Dashboard ────────────────────────────────────────────────────────────
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CSRF_HEADER_MISSING: 'CSRF_HEADER_MISSING',
  RANGE_TOO_LARGE: 'RANGE_TOO_LARGE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const INGEST_EVENT_REJECT_CODES = [
  ERROR_CODES.INVALID_EVENT,
  ERROR_CODES.EVENT_TIME_OUT_OF_RANGE,
  ERROR_CODES.PATH_OUTSIDE_APP,
  ERROR_CODES.DB_CONSTRAINT,
] as const;
export type IngestEventRejectCode = (typeof INGEST_EVENT_REJECT_CODES)[number];

export const INGEST_WARNING_CODES = [ERROR_CODES.FIELD_DROPPED, ERROR_CODES.FIELD_TRUNCATED] as const;
export type IngestWarningCode = (typeof INGEST_WARNING_CODES)[number];

/** The error envelope every non-2xx JSON response uses. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
