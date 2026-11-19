import { RELEASE_COVERAGE_TARGET, type ReleaseStatusDto } from '@nexus/shared';

import { CoverageValue } from '@/components/CoverageValue';
import { InfoTip } from '@/components/InfoTip';
import { EMPTY_VALUE, formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

import { SOURCE_LABELS } from './integrationCopy';

const PERCENT = 100;

/**
 * WHY: without a release tag a deploy is invisible in the numbers. Per source: the share of events
 * carrying `release` (amber below RELEASE_COVERAGE_TARGET) and the newest release seen — ingested
 * text, shown as text only.
 */
export function ReleaseStatus({ releases }: { releases: readonly ReleaseStatusDto[] }) {
  return (
    <section aria-label="Releases" className="space-y-2">
      <h3 className="flex items-center gap-1 text-xs font-semibold">
        Releases
        <InfoTip label="Release tagged" text={metricInfo('releaseCoverage')} />
      </h3>
      <dl className="space-y-1.5">
        {releases.map((release) => (
          <div
            key={release.source}
            className="flex min-w-0 items-baseline justify-between gap-3 text-xs"
          >
            <dt className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0">{SOURCE_LABELS[release.source]}</span>
              <span
                className="min-w-0 truncate font-mono text-2xs text-muted-foreground"
                title={release.latestRelease ?? undefined}
              >
                {release.latestRelease ?? 'no release sent'}
              </span>
            </dt>
            <dd className="flex shrink-0 items-baseline gap-2">
              <span className="text-2xs text-muted-foreground tabular">
                {release.events > 0
                  ? `${formatInteger(release.withRelease)} of ${formatInteger(release.events)}`
                  : EMPTY_VALUE}
              </span>
              <CoverageValue
                pct={release.ratio === null ? null : release.ratio * PERCENT}
                meaning={`of ${release.source} events carry a release`}
                warnBelowPct={RELEASE_COVERAGE_TARGET * PERCENT}
                className="text-sm"
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
