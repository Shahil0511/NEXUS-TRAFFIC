/**
 * Shape of the small SQL builders that carry a rule of their own (no database). Results of the
 * credited visible time are covered by the DB suite.
 */
import { VISIBLE_DELTA_CREDIT_CAP_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { creditedVisibleMs } from './sql';

describe('creditedVisibleMs (ADR 0017)', () => {
  it('credits at most the cap per row and keeps the stored delta below it', () => {
    expect(creditedVisibleMs('w')).toBe(
      `(CASE WHEN w.visible_ms > ${VISIBLE_DELTA_CREDIT_CAP_MS} THEN ${VISIBLE_DELTA_CREDIT_CAP_MS} ELSE w.visible_ms END)`,
    );
    expect(VISIBLE_DELTA_CREDIT_CAP_MS).toBe(60_000);
  });

  it('is NULL-safe: a CASE (NULL > cap is not true, so NULL stays NULL), never LEAST', () => {
    const expression = creditedVisibleMs('pt');
    expect(expression).toMatch(
      /^\(CASE WHEN pt\.visible_ms > \d+ THEN \d+ ELSE pt\.visible_ms END\)$/,
    );
    expect(expression.toLowerCase()).not.toContain('least(');
    expect(expression.toLowerCase()).not.toContain('coalesce(');
  });
});
