/**
 * Hourly SSO-cookie verification outcomes of browser beacons per app (outcome, beacon origin) —
 * WRITE side of `traffic.sso_cookie_outcomes`, read by the Integration Health page (ADR 0013):
 * it explains WHY beacons are anonymous (no cookie on a cross-origin beacon, expired, bad secret…).
 *
 * INVARIANTS
 * - One beacon = +1 (replays are never recorded: their cookie was not read).
 * - Additive upsert of the IST hour containing `at`.
 * @see ../../migrations/0012_sso_cookie_outcomes.sql
 */
import type { BeaconOrigin, SsoCookieOutcome } from '@nexus/shared';
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { bucketExpr } from '../db/sql';

export const INCREMENT_SSO_COOKIE_OUTCOMES_SQL = `INSERT INTO traffic.sso_cookie_outcomes
   (app_id, outcome, beacon_origin, bucket_hour, beacons)
VALUES ($1, $2, $3, ${bucketExpr('hour', '$4::timestamptz')}, 1)
ON CONFLICT (app_id, outcome, beacon_origin, bucket_hour) DO UPDATE
   SET beacons = traffic.sso_cookie_outcomes.beacons + EXCLUDED.beacons`;

export class SsoCookieOutcomeRepository {
  constructor(private readonly db: Pool) {}

  /** Counts ONE beacon with this outcome in the hour containing `at`. */
  async increment(
    appId: string,
    outcome: SsoCookieOutcome,
    beaconOrigin: BeaconOrigin,
    at: Date,
    exec: Executor = this.db,
  ): Promise<void> {
    await exec.query(INCREMENT_SSO_COOKIE_OUTCOMES_SQL, [appId, outcome, beaconOrigin, at]);
  }
}
