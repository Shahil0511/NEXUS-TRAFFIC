/**
 * Which environment (prod / staging / dev) an ingest batch belongs to (ADR 0008). Pure, no I/O.
 *
 * Rules:
 * - browser: a LOOPBACK page origin (localhost, *.localhost, *.local, 127.0.0.0/8, [::1]) is always
 *   `dev`, whatever the claim — localhost dev beacons (incl. the dev-cookie traffic) never reach prod;
 * - otherwise the claim when it is one of ENVIRONMENT_VALUES, else DEFAULT_ENVIRONMENT (`prod`);
 * - server: the valid claim, else `prod`. NO IP heuristic — a misconfigured proxy can make prod
 *   traffic look like loopback.
 * An unknown claim is `droppedClaim` (→ FIELD_DROPPED `environment` on the first stored event).
 */
import { DEFAULT_ENVIRONMENT, ENVIRONMENT_VALUES, type Environment, type IngestSource } from '@nexus/shared';

export interface ResolvedEnvironment {
  environment: Environment;
  /** A claim was sent but is not one of ENVIRONMENT_VALUES. */
  droppedClaim: boolean;
}

const LOOPBACK_NAMES = ['localhost'];
const LOOPBACK_SUFFIXES = ['.localhost', '.local'];
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_LOOPBACK = ['[::1]', '::1'];

/** WHY: one definition of "this page runs on a developer machine" (URL hostnames, lower-cased). */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (LOOPBACK_NAMES.includes(name) || IPV6_LOOPBACK.includes(name)) return true;
  if (LOOPBACK_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return IPV4_LOOPBACK.test(name);
}

function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENT_VALUES as readonly string[]).includes(value);
}

/** WHY: the one place the stored `environment` of a batch is decided (both ingest sources). */
export function resolveEnvironment(
  claim: string | null,
  origin: string | null,
  source: IngestSource,
): ResolvedEnvironment {
  const valid = claim !== null && isEnvironment(claim) ? claim : null;
  const droppedClaim = claim !== null && valid === null;
  const host = source === 'browser' ? hostOf(origin) : null;
  if (host !== null && isLoopbackHost(host)) return { environment: 'dev', droppedClaim };
  return { environment: valid ?? DEFAULT_ENVIRONMENT, droppedClaim };
}
