/**
 * WHY: the `client.sdk` / `client.version` the collector shows on the Integration Health page.
 * Bumped together with package.json (a test asserts they match).
 */
export const SDK_NAME = '@nexus/react';
export const SDK_VERSION = '1.1.0';

/** Storage keys. Prefixed so they never collide with the host app's own keys. */
export const STORAGE_KEYS = {
  session: 'nexus.session',
  anonymousId: 'nexus.anonymousId',
  /** `${retryQueue}:${keyScope}` in localStorage — persisted failed batches (ADR 0012). */
  retryQueue: 'nexus.retry',
  /** `${config}:${keyScope}` in localStorage — the cached remote config (ADR 0009). */
  config: 'nexus.config',
} as const;

/**
 * WHY: several apps share one origin (nexus.libas.in), so per-key storage needs a scope. Only the
 * PUBLIC prefix of the publishable key is used (`nx_pk_` + 8 chars), never the whole key.
 * Trimmed, so the early install and the tracker agree on the scope (and the kill switch reaches
 * both) even when an env var carries stray whitespace.
 */
export function keyScope(publishableKey: string): string {
  return publishableKey.trim().slice(0, 14);
}
