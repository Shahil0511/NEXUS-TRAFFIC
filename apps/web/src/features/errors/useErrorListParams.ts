'use client';

/**
 * Filters of the Errors page as URL state (`?status=&endpointId=&userKey=&errorCode=`).
 *
 * WHY THE URL: "View failures" on a route or a user links here with `endpointId` / `userKey`
 * (both OPAQUE ids, never a template or an email), and a filtered page must be shareable. Values
 * are checked against the API's own rules (STATUS_CLASS_VALUES, uuid, userKeySchema,
 * errorCodeSchema), so a hand-edited URL falls back to "all" instead of producing a 400.
 * `errorCode` is an app error code (ERROR_CODE_PATTERN: `[A-Z0-9_]`, never a message), set by a
 * click in the "Error codes" panel.
 */
import {
  errorCodeSchema,
  STATUS_CLASS_VALUES,
  userKeySchema,
  type StatusClass,
} from '@nexus/shared';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';
import { z } from 'zod';

export const DEFAULT_STATUS_CLASS: StatusClass = 'all';

export const errorListParsers = {
  status: parseAsStringLiteral(STATUS_CLASS_VALUES).withDefault(DEFAULT_STATUS_CLASS),
  endpointId: parseAsString,
  userKey: parseAsString,
  errorCode: parseAsString,
};

const endpointIdSchema = z.uuid();

/** A valid endpoint uuid, or undefined (pure; unit-tested through the view). */
export function toEndpointFilter(raw: string | null): string | undefined {
  return raw !== null && endpointIdSchema.safeParse(raw).success ? raw : undefined;
}

/** A valid user key, or undefined. */
export function toUserKeyFilter(raw: string | null): string | undefined {
  return raw !== null && userKeySchema.safeParse(raw).success ? raw : undefined;
}

/** A valid app error code, or undefined. */
export function toErrorCodeFilter(raw: string | null): string | undefined {
  return raw !== null && errorCodeSchema.safeParse(raw).success ? raw : undefined;
}

export interface ErrorListParams {
  statusClass: StatusClass;
  endpointId: string | undefined;
  userKey: string | undefined;
  errorCode: string | undefined;
  setStatusClass: (next: StatusClass) => void;
  /** Scopes the page to one error code (the "Error codes" panel). */
  setErrorCode: (next: string) => void;
  clearEndpoint: () => void;
  clearUser: () => void;
  clearErrorCode: () => void;
}

export function useErrorListParams(): ErrorListParams {
  const [raw, setRaw] = useQueryStates(errorListParsers);
  const setStatusClass = useCallback((status: StatusClass) => void setRaw({ status }), [setRaw]);
  const clearEndpoint = useCallback(() => void setRaw({ endpointId: null }), [setRaw]);
  const clearUser = useCallback(() => void setRaw({ userKey: null }), [setRaw]);
  const setErrorCode = useCallback(
    (errorCode: string) => void setRaw({ errorCode: toErrorCodeFilter(errorCode) ?? null }),
    [setRaw],
  );
  const clearErrorCode = useCallback(() => void setRaw({ errorCode: null }), [setRaw]);
  return {
    statusClass: raw.status,
    endpointId: toEndpointFilter(raw.endpointId),
    userKey: toUserKeyFilter(raw.userKey),
    errorCode: toErrorCodeFilter(raw.errorCode),
    setStatusClass,
    setErrorCode,
    clearEndpoint,
    clearUser,
    clearErrorCode,
  };
}
