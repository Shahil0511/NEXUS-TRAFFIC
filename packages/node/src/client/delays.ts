import { SDK_DEFAULTS } from '@nexus/shared/constants';

/** WHY: documented defaults for 429/503 without (or with a nonsensical) Retry-After header. */
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Exponential backoff for 5xx / network / timeout: 1 s, 2 s, 4 s … with ±20 % jitter.
 * WHY jitter: many app instances restarted together must not retry in lock-step.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const { baseDelayMs, jitterRatio } = SDK_DEFAULTS.retry;
  const base = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = (random() * 2 - 1) * jitterRatio;
  return Math.round(base * (1 + jitter));
}

/** Parse Retry-After (delta-seconds or HTTP date); default 5 s, capped at 60 s. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number {
  if (header === null || header.trim() === '') return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/** A sleep that never keeps the process alive. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
