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
  return `date_bin('${DATE_BIN_STRIDE[grain]}', ${column}, TIMESTAMPTZ '2000-01-01 00:00:00${REPORTING_UTC_OFFSET}')`;
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

/** Keyset cursor over (occurred_at, event_id) for raw event lists. */
export function encodeKeysetCursor(occurredAt: Date, eventId: string): string {
  return Buffer.from(`k:${occurredAt.toISOString()}|${eventId}`).toString('base64url');
}

export function decodeKeysetCursor(cursor: string | undefined): { occurredAt: Date; eventId: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded.startsWith('k:')) return null;
  const [iso, eventId] = decoded.slice(2).split('|');
  const occurredAt = new Date(iso ?? '');
  if (!eventId || Number.isNaN(occurredAt.getTime())) return null;
  return { occurredAt, eventId };
}
