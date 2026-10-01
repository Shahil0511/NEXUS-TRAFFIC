'use client';

/**
 * Filters of the failed-request list as URL state (`?status=&endpointId=`).
 *
 * WHY THE URL: "View failures" on a route page links here with `endpointId`, and a filtered list
 * must be shareable. Values are checked against the API's own rules (STATUS_CLASS_VALUES, uuid),
 * so a hand-edited URL falls back to "all" instead of producing a 400.
 */
import { STATUS_CLASS_VALUES, type StatusClass } from '@nexus/shared';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';
import { z } from 'zod';

export const DEFAULT_STATUS_CLASS: StatusClass = 'all';

export const errorListParsers = {
  status: parseAsStringLiteral(STATUS_CLASS_VALUES).withDefault(DEFAULT_STATUS_CLASS),
  endpointId: parseAsString,
};

const endpointIdSchema = z.uuid();

/** A valid endpoint uuid, or undefined (pure; unit-tested through the view). */
export function toEndpointFilter(raw: string | null): string | undefined {
  return raw !== null && endpointIdSchema.safeParse(raw).success ? raw : undefined;
}

export interface ErrorListParams {
  statusClass: StatusClass;
  endpointId: string | undefined;
  setStatusClass: (next: StatusClass) => void;
  clearEndpoint: () => void;
}

export function useErrorListParams(): ErrorListParams {
  const [raw, setRaw] = useQueryStates(errorListParsers);
  const setStatusClass = useCallback((status: StatusClass) => void setRaw({ status }), [setRaw]);
  const clearEndpoint = useCallback(() => void setRaw({ endpointId: null }), [setRaw]);
  return {
    statusClass: raw.status,
    endpointId: toEndpointFilter(raw.endpointId),
    setStatusClass,
    clearEndpoint,
  };
}
