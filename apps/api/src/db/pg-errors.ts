/**
 * Classify PostgreSQL errors (node-postgres DatabaseError has `code`, `constraint`, `message`).
 *
 * WHY precise: SQLSTATE 23514 is used BOTH for "no partition of relation found for row" and for
 * ordinary CHECK violations. A missing partition is fixed by creating it and retrying; a CHECK
 * violation means a poison row that must be isolated (bisected) and rejected.
 */
interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

function asPgError(err: unknown): PgErrorLike {
  return err !== null && typeof err === 'object' ? (err as PgErrorLike) : {};
}

export function isMissingPartition(err: unknown): boolean {
  const e = asPgError(err);
  return e.code === '23514' && !e.constraint && /no partition of relation/i.test(e.message ?? '');
}

/** Class 22 (data exception) or 23 (integrity) — a bad row, not a transient failure. */
export function isDataError(err: unknown): boolean {
  const e = asPgError(err);
  if (!e.code || isMissingPartition(err)) return false;
  return e.code.startsWith('22') || e.code.startsWith('23');
}

/** Connection/availability problems → 503 INGEST_UNAVAILABLE (client retries). */
export function isUnavailable(err: unknown): boolean {
  const e = asPgError(err);
  if (e.code && (e.code.startsWith('08') || e.code.startsWith('53') || e.code === '57P01' || e.code === '57P03')) {
    return true;
  }
  const message = e.message ?? '';
  return /timeout exceeded when trying to connect|Connection terminated|ECONNREFUSED/i.test(message);
}

export function isUniqueViolation(err: unknown): boolean {
  return asPgError(err).code === '23505';
}
