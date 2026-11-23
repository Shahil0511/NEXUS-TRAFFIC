/**
 * Records "this admin opened this part of this person's page" in the person access log.
 */
import { PERSON_ACCESS_COALESCE_MS, type PersonAccessSurface } from '@nexus/shared';

import type { TrafficFilter } from '../domain/filters';
import type { Viewer } from '../domain/viewer';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import { maskEmail } from '../lib/redact';
import type { PersonAccessLogRepository } from '../repositories/person-access-log.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import { PersonAccessCoalescer } from './person-access.coalescer';

/** One person-level answer about to be returned. */
export interface PersonAccess {
  viewer: Viewer;
  /** The stored user_key (bytea) of the person. */
  subjectUserKey: Buffer;
  surface: PersonAccessSurface;
  /** The window the read ran over: the person's email is looked up inside it. */
  filter: TrafficFilter;
}

/**
 * WHY: one place decides what an access-log row is. UserService, JourneyService.sessions and
 * ErrorService.summary/.list call `record` after each
 * person-level read and before returning it:
 * - COALESCED: the same viewer + person + surface at most once per PERSON_ACCESS_COALESCE_MS
 *   (PersonAccessCoalescer, in memory — see there for why).
 * - IN-FLIGHT AWARE: a request arriving while another one with the same key is still being
 *   recorded WAITS for it, and records itself when that attempt wrote nothing (its window had no
 *   event for the person, or the INSERT failed). A repeat is only skipped once a row exists, so a
 *   race can add a duplicate row, never lose one.
 * - The person is named by a MASKED email (maskEmail), computed here from their newest event in
 *   the read's window. No event there → nothing about them was shown → no row.
 * - NEVER throws: a failed write must not break the read. It logs a warning with the surface and
 *   the pg error code only (no email, no message), and releases the claim so the next request
 *   tries again.
 * @see ../repositories/person-access-log.repository.ts PersonAccessLogRepository.record
 * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.findUserEmail
 */
export class PersonAccessRecorder {
  private readonly recent: PersonAccessCoalescer;
  /** key → the attempt being recorded right now (resolves true when it wrote a row). */
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly log: PersonAccessLogRepository,
    private readonly webEvents: WebEventQueryRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    coalesceMs: number = PERSON_ACCESS_COALESCE_MS,
  ) {
    this.recent = new PersonAccessCoalescer(coalesceMs);
  }

  async record(access: PersonAccess): Promise<void> {
    const key = coalesceKey(access);
    for (;;) {
      if (await this.recordedByConcurrentAttempt(key)) return;
      if (this.recent.claim(key, this.clock.now().getTime())) break;
      // Claimed and nothing running: a row was written inside the window (coalesced).
      if (!this.inFlight.has(key)) return;
      // Another waiter started its own attempt first: wait for that one.
    }
    const attempt = this.write(access, key);
    this.inFlight.set(key, attempt);
    try {
      await attempt;
    } finally {
      if (this.inFlight.get(key) === attempt) this.inFlight.delete(key);
    }
  }

  /**
   * Waits for the attempts with the same key that are running; true as soon as one wrote a row.
   * False when none is running (any more) or none wrote: the caller then tries itself.
   */
  private async recordedByConcurrentAttempt(key: string): Promise<boolean> {
    let pending = this.inFlight.get(key);
    while (pending) {
      if (await pending) return true;
      const next = this.inFlight.get(key);
      pending = next === pending ? undefined : next;
    }
    return false;
  }

  /** One attempt: email lookup → INSERT. True when a row was written; else the claim is released. */
  private async write(access: PersonAccess, key: string): Promise<boolean> {
    try {
      const email = await this.webEvents.findUserEmail(access.subjectUserKey, access.filter);
      if (email === null) {
        this.recent.release(key);
        return false;
      }
      await this.log.record({
        viewerEmail: access.viewer.email,
        subjectUserKey: access.subjectUserKey,
        subjectEmailMasked: maskEmail(email),
        surface: access.surface,
      });
      return true;
    } catch (err) {
      this.recent.release(key);
      this.logger.warn('person access log write failed', {
        surface: access.surface,
        code: errorCodeOf(err),
      });
      return false;
    }
  }
}

/** viewer + person + surface. The email is lower-cased like the SSO identity. */
function coalesceKey(access: PersonAccess): string {
  return [
    access.viewer.email.toLowerCase(),
    access.subjectUserKey.toString('hex'),
    access.surface,
  ].join('|');
}

/** The pg SQLSTATE (or the error's name) — never its message, which may quote a value. */
function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (err instanceof Error) return err.name;
  }
  return 'unknown';
}
