/**
 * The typed error every dashboard API call throws.
 *
 * WHY: the API answers every failure with the shared envelope `{ error: { code, message,
 * requestId } }` (packages/shared/src/errors.ts). Turning it into one class lets hooks and
 * components branch on `code`/`status` (no retry on 4xx, re-login on 401) and show the
 * `requestId` so a user can quote it when reporting a problem.
 */
import { ERROR_CODES, INGEST_HEADERS, type ApiErrorBody, type ErrorCode } from '@nexus/shared';

/** Client-side failures that never reached the API (offline, DNS, CORS, aborted). */
export const NETWORK_ERROR = 'NETWORK_ERROR';
export type ApiErrorCode = ErrorCode | typeof NETWORK_ERROR;

const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;
const HTTP_STATUS_GATEWAY = [502, 503, 504];

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId: string | null = null,
    readonly details: unknown = undefined,
  ) {
    super(message);
  }

  /** 4xx: retrying the same request cannot succeed. */
  get isClientError(): boolean {
    return (
      this.status >= HTTP_STATUS_CLIENT_ERROR_MIN && this.status < HTTP_STATUS_SERVER_ERROR_MIN
    );
  }

  /** The SSO cookie is missing/expired: the user must sign in again. */
  get isUnauthorized(): boolean {
    return this.status === HTTP_STATUS_UNAUTHORIZED;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

/** Code used when the body is not our envelope (e.g. an nginx 502 HTML page). */
function fallbackCode(status: number): ErrorCode {
  if (HTTP_STATUS_GATEWAY.includes(status)) return ERROR_CODES.SERVICE_UNAVAILABLE;
  if (status === HTTP_STATUS_UNAUTHORIZED) return ERROR_CODES.UNAUTHORIZED;
  return ERROR_CODES.INTERNAL_ERROR;
}

/** Build an ApiError from a non-2xx response; never throws while doing so. */
export async function toApiError(response: Response): Promise<ApiError> {
  const headerRequestId = response.headers.get(INGEST_HEADERS.requestId);
  const body: unknown = await response.json().catch(() => null);
  if (isErrorBody(body)) {
    const { code, message, details, requestId } = body.error;
    return new ApiError(response.status, code, message, requestId ?? headerRequestId, details);
  }
  const message = response.statusText || `Request failed with status ${response.status}`;
  return new ApiError(response.status, fallbackCode(response.status), message, headerRequestId);
}

/** Wrap a fetch rejection (network down, aborted) in the same type. */
export function toNetworkError(cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : 'Network request failed';
  return new ApiError(0, NETWORK_ERROR, message);
}
