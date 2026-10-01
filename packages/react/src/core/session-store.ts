/**
 * Per-tab session + per-session `seq`, and the per-device anonymous id.
 *
 * WHY: the browser contract requires ONE session id per tab (sessionStorage), a new one after
 * `SDK_DEFAULTS.browser.sessionIdleMs` without activity or when the signed-in user changes, and a
 * `seq` that increases by one per event within a session (it orders a journey when timestamps tie).
 */
import type { SafeStorage } from './safe-storage';
import { STORAGE_KEYS } from './sdk-info';
import { createUuid, isUuid } from './uuid';

interface SessionRecord {
  id: string;
  lastActivityAt: number;
  seq: number;
  email?: string;
}

export interface SessionTick {
  sessionId: string;
  seq: number;
}

export class SessionStore {
  constructor(
    private readonly storage: SafeStorage,
    private readonly idleMs: number,
  ) {}

  /** WHY: called once per event — rotates if needed, marks activity and hands out the next seq. */
  nextEvent(email: string | undefined, now: number): SessionTick {
    const record = this.current(email, now);
    this.write({ ...record, seq: record.seq + 1, lastActivityAt: now });
    return { sessionId: record.id, seq: record.seq };
  }

  /**
   * WHY: the session id for propagated headers WITHOUT consuming a seq. Rotates (and persists the
   * rotation) when the stored session is stale, so headers never carry a dead id.
   */
  peek(email: string | undefined, now: number): string {
    return this.current(email, now).id;
  }

  /** WHY: the single place that decides between "keep" and "rotate". */
  private current(email: string | undefined, now: number): SessionRecord {
    const stored = this.read();
    if (stored && !shouldRotate(stored, email, now, this.idleMs)) {
      // Anonymous → signed in keeps the session (auth often resolves after the first render).
      if (email && !stored.email) {
        const adopted = { ...stored, email };
        this.write(adopted);
        return adopted;
      }
      return stored;
    }
    const fresh: SessionRecord = {
      id: createUuid(),
      lastActivityAt: now,
      seq: 0,
      ...(email ? { email } : {}),
    };
    this.write(fresh);
    return fresh;
  }

  /** WHY: storage content is untrusted (old versions, manual edits) — validate every field. */
  private read(): SessionRecord | undefined {
    try {
      const raw = this.storage.get(STORAGE_KEYS.session);
      if (!raw) return undefined;
      const value = JSON.parse(raw) as Partial<SessionRecord>;
      if (!isUuid(value.id)) return undefined;
      if (typeof value.lastActivityAt !== 'number' || !Number.isFinite(value.lastActivityAt)) {
        return undefined;
      }
      if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq < 0) {
        return undefined;
      }
      return {
        id: value.id,
        lastActivityAt: value.lastActivityAt,
        seq: value.seq,
        ...(typeof value.email === 'string' && value.email ? { email: value.email } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private write(record: SessionRecord): void {
    this.storage.set(STORAGE_KEYS.session, JSON.stringify(record));
  }
}

/**
 * WHY: rotation rules in one pure function.
 * - idle longer than `idleMs` → rotate;
 * - a session started for user A and now user B (or nobody — sign-out) → rotate;
 * - anonymous → signed in does NOT rotate (same person, auth resolved late).
 */
export function shouldRotate(
  record: { lastActivityAt: number; email?: string },
  email: string | undefined,
  now: number,
  idleMs: number,
): boolean {
  if (now - record.lastActivityAt > idleMs) return true;
  return record.email !== undefined && record.email !== email;
}

/** WHY: one id per device (localStorage) so returning anonymous visitors can be counted. */
export class AnonymousIdStore {
  private cached: string | undefined;

  constructor(private readonly storage: SafeStorage) {}

  get(): string {
    if (this.cached) return this.cached;
    const stored = this.storage.get(STORAGE_KEYS.anonymousId);
    const id = isUuid(stored) ? stored : createUuid();
    if (id !== stored) this.storage.set(STORAGE_KEYS.anonymousId, id);
    this.cached = id;
    return id;
  }
}
