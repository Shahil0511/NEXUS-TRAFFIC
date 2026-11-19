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
  /** Personal data (email, phone, PAN, GSTIN, Aadhaar) was replaced or dropped (ADR 0010). */
  FIELD_REDACTED: 'FIELD_REDACTED',

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

export const INGEST_WARNING_CODES = [
  ERROR_CODES.FIELD_DROPPED,
  ERROR_CODES.FIELD_TRUNCATED,
  ERROR_CODES.FIELD_REDACTED,
] as const;
export type IngestWarningCode = (typeof INGEST_WARNING_CODES)[number];

/**
 * WHY: the codes counted in `traffic.ingest_rejections` (0010, CHECK mirrors this list) — every
 * per-event reject code plus the two envelope-level refusals that happen AFTER the app is known
 * (server INVALID_ENVELOPE: validated after key auth; browser ORIGIN_NOT_ALLOWED).
 */
export const INGEST_REJECTION_CODE_VALUES = [
  ...INGEST_EVENT_REJECT_CODES,
  ERROR_CODES.INVALID_ENVELOPE,
  ERROR_CODES.ORIGIN_NOT_ALLOWED,
] as const;
export type IngestRejectionCode = (typeof INGEST_REJECTION_CODE_VALUES)[number];

/**
 * WHY: a 401/403 carrying one of these codes means "this key will never be accepted as it is" —
 * the browser SDK stops capturing for that key (kill switch, ADR 0009) instead of retrying.
 */
export const SDK_KILL_ERROR_CODES = [
  ERROR_CODES.APP_DISABLED,
  ERROR_CODES.BROWSER_INGEST_DISABLED,
  ERROR_CODES.INVALID_API_KEY,
  ERROR_CODES.WRONG_KEY_TYPE,
  ERROR_CODES.SECRET_KEY_EXPOSED,
] as const;
export type SdkKillErrorCode = (typeof SDK_KILL_ERROR_CODES)[number];

/**
 * WHY: the failures that mean "someone is guessing keys". They count toward the per-IP failure
 * limiter (together with ORIGIN_NOT_ALLOWED — see IP_FAILURE_ERROR_CODES). The kill codes
 * (APP_DISABLED, BROWSER_INGEST_DISABLED, SECRET_KEY_EXPOSED) must not, or a killed app's old SDKs
 * behind one office NAT would block every app from that IP (ADR 0009).
 */
export const KEY_GUESS_ERROR_CODES = [
  ERROR_CODES.MISSING_API_KEY,
  ERROR_CODES.INVALID_API_KEY,
  ERROR_CODES.WRONG_KEY_TYPE,
] as const;
export type KeyGuessErrorCode = (typeof KEY_GUESS_ERROR_CODES)[number];

/**
 * WHY: what the per-IP failure limiter actually counts — the key guesses PLUS ORIGIN_NOT_ALLOWED.
 * A publishable key is public by design, and originGuard refuses a forged / missing Origin BEFORE
 * the key and session limiters run (and each refusal writes an ingest_rejections row), so without
 * this a script could flood that path unbounded. The kill codes (APP_DISABLED,
 * BROWSER_INGEST_DISABLED, SECRET_KEY_EXPOSED) stay exempt: old SDKs of a killed app behind one
 * office NAT must not block every app from that IP (ADR 0009).
 */
export const IP_FAILURE_ERROR_CODES = [...KEY_GUESS_ERROR_CODES, ERROR_CODES.ORIGIN_NOT_ALLOWED] as const;
export type IpFailureErrorCode = (typeof IP_FAILURE_ERROR_CODES)[number];

/** The error envelope every non-2xx JSON response uses. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
