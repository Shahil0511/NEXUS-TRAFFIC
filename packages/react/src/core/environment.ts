/**
 * The envelope `environment` and `release` (ADR 0008, A5).
 *
 * WHY: staging and local dev beacons must never land in the prod dashboards. The app says which
 * environment it is (`environment` option); without one, a loopback page is `dev` and anything
 * else is left to the server default (`prod`).
 */
import { ENVIRONMENT_VALUES, INGEST_LIMITS, type Environment } from '@nexus/shared/constants';

/**
 * WHY a literal copy: the published .d.ts must not import @nexus/shared (not installed by
 * consumers). The two assertions below fail the typecheck if it ever drifts from the contract.
 */
export type NexusEnvironment = 'prod' | 'staging' | 'dev';
const _environmentMatches: Environment extends NexusEnvironment ? true : never = true;
const _environmentCovers: NexusEnvironment extends Environment ? true : never = true;
void _environmentMatches;
void _environmentCovers;

/** WHY: a JS caller may pass anything — only a contract value is sent. */
export function cleanEnvironment(value: unknown): NexusEnvironment | undefined {
  return (ENVIRONMENT_VALUES as readonly unknown[]).includes(value)
    ? (value as NexusEnvironment)
    : undefined;
}

/** WHY: `localhost`, `*.localhost`, `*.local`, 127.0.0.0/8 and [::1] are developer machines. */
export function defaultEnvironment(hostname: string | undefined): NexusEnvironment | undefined {
  const host = (hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return undefined;
  const loopback =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host);
  return loopback ? 'dev' : undefined;
}

/** WHY: an invalid release is dropped locally (the batch is never put at risk for it). */
export function cleanRelease(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > INGEST_LIMITS.maxReleaseLength) return undefined;
  return trimmed;
}
