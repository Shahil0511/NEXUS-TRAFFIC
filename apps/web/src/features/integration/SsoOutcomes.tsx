import type { SsoCookieOutcomeDto } from '@nexus/shared';

import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

import { BEACON_ORIGIN_LABELS, SSO_OUTCOME_COPY } from './integrationCopy';

/** Busiest first (a copy; the DTO array is never mutated). */
export function sortOutcomes(outcomes: readonly SsoCookieOutcomeDto[]): SsoCookieOutcomeDto[] {
  return [...outcomes].sort((a, b) => b.beacons - a.beacons);
}

/**
 * WHY: "why are my browser users anonymous?" — the SSO cookie verification outcome of the window's
 * browser batches, each with what it means and the fix (e.g. no-cookie → cookie Path/Domain/
 * SameSite; bad-signature → LIBAS_JWT_SECRET mismatch), split by whether the beacon was same- or
 * cross-origin (a cross-origin beacon carries the cookie only when its Domain and SameSite allow).
 */
export function SsoOutcomes({
  outcomes,
  appName,
}: {
  outcomes: readonly SsoCookieOutcomeDto[];
  appName: string;
}) {
  return (
    <section aria-label={`SSO cookie outcomes of ${appName}`} className="space-y-2">
      <h3 className="text-xs font-semibold">SSO cookie (browser identity)</h3>
      <ul className="space-y-1.5">
        {sortOutcomes(outcomes).map((row) => (
          <li
            key={`${row.outcome}|${row.beaconOrigin}`}
            className="flex min-w-0 items-start justify-between gap-3 text-xs"
          >
            <span className="min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'font-mono font-medium',
                    row.outcome === 'ok' ? 'text-success' : 'text-warning',
                  )}
                >
                  {row.outcome}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {BEACON_ORIGIN_LABELS[row.beaconOrigin]}
                </span>
              </span>
              <span className="block text-2xs leading-relaxed text-muted-foreground">
                {SSO_OUTCOME_COPY[row.outcome]}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular">{formatInteger(row.beacons)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
