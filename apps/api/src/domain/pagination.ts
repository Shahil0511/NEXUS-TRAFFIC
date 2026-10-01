/**
 * "Fetch one more than you show" paging.
 *
 * WHY: services ask the repository for `limit + 1` rows; if the extra row came back there is a next
 * page, and its cursor is built from the LAST SHOWN row (keyset) or the next offset. This needs no
 * second COUNT query and works the same for offset cursors (aggregate lists) and keyset cursors
 * (raw event lists).
 */
import type { CursorPage } from '@nexus/shared';

import { decodeKeysetCursor } from '../db/sql';
import { BadRequestError } from '../errors/app-error';
import type { EventKeyset } from './filters';

/** event_id is a uuid column: a tampered cursor must fail as 400 here, not as a SQL cast error. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many rows to request for a page of `limit` items. */
export function pageFetchSize(limit: number): number {
  return limit + 1;
}

/**
 * Split `rows` (fetched with `pageFetchSize(limit)`) into the shown items and the next cursor.
 * `cursorAfter` receives the last shown ROW (before mapping), so keyset cursors can use raw columns.
 */
export function toCursorPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  mapRow: (row: Row) => Item,
  cursorAfter: (lastShown: Row) => string,
): CursorPage<Item> {
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return { items: shown.map(mapRow), nextCursor: hasMore ? cursorAfter(last) : null };
}

/**
 * Keyset cursor of a raw event list → position, or null for the first page. A cursor that was sent
 * but cannot be decoded is a client error (400): silently restarting at page one would show the
 * user duplicates.
 */
export function parseKeysetCursor(cursor: string | undefined): EventKeyset | null {
  if (cursor === undefined) return null;
  const keyset = decodeKeysetCursor(cursor);
  if (!keyset || !UUID_PATTERN.test(keyset.eventId)) throw new BadRequestError('Invalid cursor');
  return keyset;
}
