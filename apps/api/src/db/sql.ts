/**
 * Small SQL-building helpers. Values ALWAYS go through `$n` placeholders; identifiers and
 * ORDER BY columns come only from frozen whitelists — never from user input.
 */
import { REPORTING_UTC_OFFSET, REPORTING_TIME_ZONE, type Grain } from '@nexus/shared';

/** Collects positional parameters: `where.push(\`app_id = ${p.add(appId)}\`)`. */
export class ParamList {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** ORDER BY from a whitelist map { apiSortKey: 'sql_expression' }. Throws on unknown keys. */
export function orderByClause(
  whitelist: Readonly<Record<string, string>>,
  key: string,
  direction: 'asc' | 'desc',
): string {
  const column = whitelist[key];
  if (!column) throw new Error(`orderByClause: "${key}" is not whitelisted`);
  return `ORDER BY ${column} ${direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
}

/**
 * Origin of every sub-day bucket: midnight IST on 2000-01-01. Shared with the gap filler
 * (domain/timeseries-gaps.ts) so empty buckets land exactly where SQL buckets would.
 */
export const BUCKET_ORIGIN_ISO = `2000-01-01T00:00:00${REPORTING_UTC_OFFSET}`;

const DATE_BIN_STRIDE: Record<Exclude<Grain, 'day'>, string> = {
  minute: '1 minute',
  hour: '1 hour',
};

/**
 * Bucket expression aligned to the reporting timezone (Asia/Kolkata, +05:30).
 * Sub-day grains use date_bin with an IST origin (a UTC origin would shift hourly buckets by 30 min);
 * days use the 3-argument date_trunc (PG ≥ 12). `column` MUST be a trusted identifier.
 */
export function bucketExpr(grain: Grain, column = 'occurred_at'): string {
  if (grain === 'day') return `date_trunc('day', ${column}, '${REPORTING_TIME_ZONE}')`;
  return `date_bin('${DATE_BIN_STRIDE[grain]}', ${column}, TIMESTAMPTZ '${BUCKET_ORIGIN_ISO}')`;
}

/** Opaque offset cursor for aggregate lists (keyset is not meaningful over GROUP BY results). */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number(decoded.startsWith('o:') ? decoded.slice(2) : NaN);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

/**
 * SQL rendering `column` (a timestamptz) as ISO-8601 UTC text with MICROSECONDS, e.g.
 * `2026-10-01T09:15:30.123456Z`. Keyset cursors MUST use it instead of the parsed JS Date:
 * `occurred_at` is the sender's value stored verbatim (up to µs precision) and a Date keeps only
 * milliseconds, so a Date-based cursor would repeat rows at a page boundary. `column` MUST be a
 * trusted identifier.
 */
export function keysetTimeExpr(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** What keysetTimeExpr produces (also accepts fewer fractional digits). */
const KEYSET_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Keyset cursor over (occurred_at, event_id) for raw event lists. `occurredAt` is the µs-precision
 * text of keysetTimeExpr (never `Date#toISOString`, see there).
 */
export function encodeKeysetCursor(occurredAt: string, eventId: string): string {
  return Buffer.from(`k:${occurredAt}|${eventId}`).toString('base64url');
}

/** Cursor → keyset, or null when it is not a well-formed keyset cursor. */
export function decodeKeysetCursor(
  cursor: string | undefined,
): { occurredAt: string; eventId: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded.startsWith('k:')) return null;
  const [occurredAt, eventId] = decoded.slice(2).split('|');
  if (!eventId || !occurredAt || !KEYSET_TIME_PATTERN.test(occurredAt)) return null;
  if (Number.isNaN(Date.parse(occurredAt))) return null;
  return { occurredAt, eventId };
}

/**
 * `%text%` for a parameterised (I)LIKE "contains" search. `\`, `%` and `_` in user input are
 * escaped (backslash is PostgreSQL's default LIKE escape), so a search for `50%` matches literally.
 */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
