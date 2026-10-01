/**
 * Small, pure field sanitizers.
 *
 * WHY: one bad header must never cost the whole event (the server would reject it) — invalid
 * optional values are simply left out.
 */
import { ERROR_CODE_PATTERN } from '@nexus/shared/constants';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First value of a possibly repeated header. */
export function headerValue(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === undefined ? undefined : String(value);
}

/** A non-empty trimmed string within `max` characters, else undefined. */
export function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= max ? trimmed : undefined;
}

/** A non-empty string cut to `max` characters (for long-but-useful values like user agents). */
export function truncatedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return value.slice(0, max);
}

export function optionalUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

/** A content-length header as a non-negative integer. */
export function optionalBytes(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const bytes = Number(value);
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

export function optionalErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : undefined;
}

/** Run a user callback; a throwing callback must never break the request. */
export function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
