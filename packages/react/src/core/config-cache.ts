/**
 * The cached remote config per key scope (ADR 0009) — NO network code (the early entry imports it).
 *
 * WHY: a known kill must be honoured SYNCHRONOUSLY at the next page load, before anything is
 * patched or sent; the network answer arrives too late for that. The cache lives in localStorage
 * under `${STORAGE_KEYS.config}:${keyScope}` and is untrusted on read (validated field by field).
 */
import {
  INGEST_CONTRACT_VERSION,
  SDK_BROWSER_CONFIG_MAX_STALE_MS,
  SDK_CAPTURE_MODULE_VALUES,
} from '@nexus/shared/constants';

import { STORAGE_KEYS } from './sdk-info';
import type { SdkRemoteConfigWire } from './wire';

export interface CachedConfig {
  /** When the server last answered (epoch ms). */
  at: number;
  /** false = a kill code was received (re-checked after `disabledRecheckMs`). */
  enabled: boolean;
  /** The last valid 200 body, kept across a kill so a version regression is still detected. */
  config: SdkRemoteConfigWire | null;
}

/** WHY: a cache older than `configMaxStaleMs` is ignored — the code defaults apply instead. */
export function readCachedConfig(keyScope: string, now: number = Date.now()): CachedConfig | null {
  try {
    const raw = localStorageOrUndefined()?.getItem(cacheKey(keyScope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedConfig> | null;
    if (!value || typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
    if (typeof value.enabled !== 'boolean') return null;
    if (now - value.at > SDK_BROWSER_CONFIG_MAX_STALE_MS) return null;
    return { at: value.at, enabled: value.enabled, config: parseRemoteConfig(value.config) };
  } catch {
    return null;
  }
}

/** WHY: never throws; a blocked storage simply means no cache (fail open). */
export function writeCachedConfig(keyScope: string, cached: CachedConfig): void {
  try {
    localStorageOrUndefined()?.setItem(cacheKey(keyScope), JSON.stringify(cached));
  } catch {
    // no cache
  }
}

/** WHY: true when the cached state forbids header propagation (kill or module switch). */
export function cachedBlocksPropagation(cached: CachedConfig | null): boolean {
  if (!cached) return false;
  if (!cached.enabled) return true;
  return cached.config?.disabledModules.includes('header_propagation') ?? false;
}

/**
 * Hand-written validator of the 200 body (zod is never bundled into the SDK; the tests check
 * this against `sdkRemoteConfigSchema`). Unknown module names are dropped, not fatal.
 */
export function parseRemoteConfig(json: unknown): SdkRemoteConfigWire | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const value = json as Record<string, unknown>;
  if (value['contract'] !== INGEST_CONTRACT_VERSION) return null;
  const version = value['version'];
  const maxAgeMs = value['maxAgeMs'];
  if (!Number.isInteger(version) || (version as number) < 1) return null;
  if (!Number.isInteger(maxAgeMs) || (maxAgeMs as number) < 0) return null;
  if (typeof value['enabled'] !== 'boolean') return null;
  const modules = value['disabledModules'];
  if (!Array.isArray(modules)) return null;
  const known = SDK_CAPTURE_MODULE_VALUES as readonly unknown[];
  return {
    contract: INGEST_CONTRACT_VERSION,
    version: version as number,
    enabled: value['enabled'],
    disabledModules: modules.filter((m): m is SdkRemoteConfigWire['disabledModules'][number] =>
      known.includes(m),
    ),
    maxAgeMs: maxAgeMs as number,
  };
}

function cacheKey(keyScope: string): string {
  return `${STORAGE_KEYS.config}:${keyScope}`;
}

/** WHY: accessing `window.localStorage` can itself throw (sandboxed iframe, blocked cookies). */
function localStorageOrUndefined(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
