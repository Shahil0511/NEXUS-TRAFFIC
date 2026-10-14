'use client';

/**
 * Filters of the Errors page as URL state (`?status=&endpointId=&userKey=`).
 *
 * WHY THE URL: "View failures" on a route or a user links here with `endpointId` / `userKey`
 * (both OPAQUE ids, never a template or an email), and a filtered page must be shareable. Values
 * are checked against the API's own rules (STATUS_CLASS_VALUES, uuid, userKeySchema), so a
 * hand-edited URL falls back to "all" instead of producing a 400.
 */
import { STATUS_CLASS_VALUES, userKeySchema, type StatusClass } from '@nexus/shared';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';
import { z } from 'zod';

export const DEFAULT_STATUS_CLASS: StatusClass = 'all';

export const errorListParsers = {
  status: parseAsStringLiteral(STATUS_CLASS_VALUES).withDefault(DEFAULT_STATUS_CLASS),
  endpointId: parseAsString,
  userKey: parseAsString,
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

export interface ErrorListParams {
  statusClass: StatusClass;
  endpointId: string | undefined;
  userKey: string | undefined;
  setStatusClass: (next: StatusClass) => void;
  clearEndpoint: () => void;
  clearUser: () => void;
}

export function useErrorListParams(): ErrorListParams {
  const [raw, setRaw] = useQueryStates(errorListParsers);
  const setStatusClass = useCallback((status: StatusClass) => void setRaw({ status }), [setRaw]);
  const clearEndpoint = useCallback(() => void setRaw({ endpointId: null }), [setRaw]);
  const clearUser = useCallback(() => void setRaw({ userKey: null }), [setRaw]);
  return {
    statusClass: raw.status,
    endpointId: toEndpointFilter(raw.endpointId),
    userKey: toUserKeyFilter(raw.userKey),
    setStatusClass,
    clearEndpoint,
    clearUser,
  };
}
