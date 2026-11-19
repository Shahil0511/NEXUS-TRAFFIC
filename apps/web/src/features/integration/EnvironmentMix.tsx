import { DEFAULT_ENVIRONMENT, INGEST_SOURCE_VALUES, type EnvironmentMixDto } from '@nexus/shared';

import { Badge } from '@/components/ui/badge';
import { ENVIRONMENT_LABELS } from '@/features/filters/environmentLabels';
import { formatInteger } from '@/lib/format';

import { SOURCE_LABELS } from './integrationCopy';

/**
 * WHY: Integration health is NOT environment-filtered (ADR 0008) — it shows which environments
 * each source sends from, so a staging deploy reporting as production (or the reverse) is visible
 * at a glance. Non-production environments are tinted; the label carries the meaning.
 */
export function EnvironmentMix({ environments }: { environments: readonly EnvironmentMixDto[] }) {
  return (
    <section aria-label="Environments" className="space-y-2">
      <h3 className="text-xs font-semibold">Environments</h3>
      {environments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No events in the window.</p>
      ) : (
        <dl className="space-y-1.5">
          {INGEST_SOURCE_VALUES.map((source) => {
            const rows = environments.filter((row) => row.source === source);
            if (rows.length === 0) return null;
            return (
              <div key={source} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <dt className="w-16 shrink-0 text-xs text-muted-foreground">
                  {SOURCE_LABELS[source]}
                </dt>
                {rows.map((row) => (
                  <dd key={row.environment}>
                    <Badge
                      variant={row.environment === DEFAULT_ENVIRONMENT ? 'outline' : 'warning'}
                    >
                      {ENVIRONMENT_LABELS[row.environment]}
                      <span className="font-normal tabular">{formatInteger(row.events)}</span>
                    </Badge>
                  </dd>
                ))}
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
