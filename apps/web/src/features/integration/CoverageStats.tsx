import type { CoverageDto, LinkingCoverageDto } from '@nexus/shared';

import { CoverageValue } from '@/components/CoverageValue';
import { InfoTip } from '@/components/InfoTip';
import { formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

import { DEFAULT_BLOCK_HEADING, type BlockHeading } from './blockHeading';
import { IDENTITY_SCOPE_NOTE } from './integrationCopy';

const PERCENT = 100;

const pctOf = (ratio: number | null) => (ratio === null ? null : ratio * PERCENT);

interface CoverageRowProps {
  label: string;
  info: string;
  pct: number | null;
  meaning: string;
  detail: string;
}

function CoverageRow({ label, info, pct, meaning, detail }: CoverageRowProps) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="flex min-w-0 items-center gap-1 text-xs">
        <span className="truncate">{label}</span>
        <InfoTip label={label} text={info} />
      </dt>
      <dd className="flex shrink-0 items-baseline gap-2 text-xs">
        <span className="text-2xs text-muted-foreground tabular">{detail}</span>
        <CoverageValue pct={pct} meaning={meaning} className="text-sm" />
      </dd>
    </div>
  );
}

/**
 * WHY: is the integration DEEP enough to be useful — are users identified (per source), and do
 * API calls link to the browser session (and page view) that made them? A null ratio ("—") means
 * fewer than COVERAGE_MIN_EVENTS events: too little data for a verdict.
 */
export function CoverageStats({
  identityCoverage,
  linkingCoverage,
  headingAs: Heading = DEFAULT_BLOCK_HEADING,
}: {
  identityCoverage: readonly CoverageDto[];
  linkingCoverage: LinkingCoverageDto;
  headingAs?: BlockHeading;
}) {
  return (
    <section aria-label="Coverage" className="space-y-2">
      <Heading className="text-xs font-semibold">Coverage</Heading>
      <dl className="space-y-1.5">
        {identityCoverage.map((coverage) => (
          <CoverageRow
            key={coverage.source}
            label={`Identified (${coverage.source})`}
            info={metricInfo('identityCoverage')}
            pct={pctOf(coverage.ratio)}
            meaning={`of ${coverage.source} events carry a verified user`}
            detail={`${formatInteger(coverage.covered)} of ${formatInteger(coverage.events)}`}
          />
        ))}
        <CoverageRow
          label="Linked API calls"
          info={metricInfo('linkingCoverage')}
          pct={pctOf(linkingCoverage.ratio)}
          meaning="of linkable API calls carry the browser session"
          detail={`${formatInteger(linkingCoverage.linked)} of ${formatInteger(linkingCoverage.linkable)} · ${formatInteger(linkingCoverage.pageViewLinked)} with page view`}
        />
      </dl>
      <p className="text-2xs text-muted-foreground">{IDENTITY_SCOPE_NOTE}</p>
    </section>
  );
}
