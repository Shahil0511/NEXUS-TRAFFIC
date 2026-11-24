'use client';

import { BREAKDOWN_LIMIT_MAX, type BreakdownDto, type TimeWindowQuery } from '@nexus/shared';
import { Ban, ListTree } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { InfoTip } from '@/components/InfoTip';
import { ListSkeleton, Panel } from '@/components/Panel';
import { ProportionBar, ProportionTable } from '@/components/ProportionBar';
import { withRemainder } from '@/components/proportionShares';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useBreakdown } from '@/features/breakdowns/useBreakdown';
import { metricInfo } from '@/lib/metricCopy';

import {
  breakdownRows,
  DEVICES_DIMENSION_COPY,
  isDimensionAvailable,
  SHARE_OF_COPY,
  UNIT_OF_SOURCE,
  type DevicesPageDimension,
  type ShareOf,
} from './shareOf';

/** Bars per panel; the rest is one "All other values" bar and the "Show all values" table. */
export const DIMENSION_TOP_N = 6;

export interface DimensionSharePanelProps {
  dimension: DevicesPageDimension;
  /** The page's filters (app, range, environment). */
  filters: TimeWindowQuery;
  share: ShareOf;
  /** Switch the page to page views (offered when this dimension has no server column). */
  onUsePageViews: () => void;
}

/**
 * WHY: one dimension (browser, time zone …) as labelled proportion bars of the chosen unit. A
 * dimension the chosen source does not have is greyed out WITHOUT a request (the API refuses
 * it for source=server), and says how to see it.
 * Chain: useBreakdown → api.overview.breakdown → ROUTES.overview.breakdown.
 */
export function DimensionSharePanel(props: DimensionSharePanelProps) {
  return isDimensionAvailable(props.dimension, props.share) ? (
    <AvailableDimensionPanel {...props} />
  ) : (
    <UnavailableDimensionPanel {...props} />
  );
}

function UnavailableDimensionPanel({ dimension, share, onUsePageViews }: DimensionSharePanelProps) {
  const copy = DEVICES_DIMENSION_COPY[dimension];
  const unit = UNIT_OF_SOURCE[SHARE_OF_COPY[share].source];
  return (
    <Panel
      title={copy.title}
      icon={copy.icon}
      description={copy.description}
      // WHY no opacity fade: it pushed the muted text and the working button below AA contrast.
      // A dashed outline marks "not available" while the text keeps its full token colour.
      className="border border-dashed border-foreground/20 shadow-none ring-0 hover:shadow-none"
    >
      <EmptyState
        icon={Ban}
        title={`Not available for ${unit}`}
        description={`Server requests do not carry the ${copy.title.toLowerCase()}; only the browser tracker sends it.`}
        action={
          <Button variant="outline" size="sm" onClick={onUsePageViews}>
            Show share of page views
          </Button>
        }
      />
    </Panel>
  );
}

function AvailableDimensionPanel({ dimension, filters, share }: DimensionSharePanelProps) {
  const copy = DEVICES_DIMENSION_COPY[dimension];
  const source = SHARE_OF_COPY[share].source;
  const breakdown = useBreakdown({ ...filters, source, dimension, limit: DIMENSION_TOP_N });
  const dto = breakdown.data;

  return (
    <Panel
      title={copy.title}
      icon={copy.icon}
      description={copy.description}
      aside={<InfoTip label="Share" text={metricInfo('breakdownShare')} />}
    >
      <QueryState
        query={breakdown}
        skeleton={<ListSkeleton rows={4} />}
        isEmpty={dto?.items.length === 0}
        empty={
          <EmptyState
            title={`No ${copy.title.toLowerCase()} data in this window`}
            description={`Values appear once the app sends ${UNIT_OF_SOURCE[source]} with this detail for the selected app, range and environment.`}
          />
        }
      >
        {() => (
          // The unit follows the DATA's source: while a new choice loads, the previous bars stay
          // (keepPreviousData) and must keep their own unit.
          <div className="space-y-3">
            <ProportionBar
              caption={`${copy.title}: share of ${UNIT_OF_SOURCE[dto!.source]}`}
              rows={withRemainder(breakdownRows(dto!), dto!.total)}
              unit={UNIT_OF_SOURCE[dto!.source]}
              valueHeader={copy.title}
            />
            <AllValuesDialog dimension={dimension} filters={filters} share={share} />
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

// ─── Show all values ─────────────────────────────────────────────────────────

function AllValuesDialog({
  dimension,
  filters,
  share,
}: Pick<DimensionSharePanelProps, 'dimension' | 'filters' | 'share'>) {
  const copy = DEVICES_DIMENSION_COPY[dimension];
  const unit = UNIT_OF_SOURCE[SHARE_OF_COPY[share].source];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Show all values: ${copy.title}`}>
          <ListTree aria-hidden="true" /> Show all values
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}: all values</DialogTitle>
          <DialogDescription>
            Every value in the selected range, as a share of {unit}.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open (Radix unmounts closed content), so the long list is fetched on demand. */}
        <AllValuesTable dimension={dimension} filters={filters} share={share} />
      </DialogContent>
    </Dialog>
  );
}

/** True when the API returned as many values as it ever does: more may exist. */
export function isCappedBreakdown(dto: BreakdownDto): boolean {
  return dto.items.length >= BREAKDOWN_LIMIT_MAX;
}

function AllValuesTable({
  dimension,
  filters,
  share,
}: Pick<DimensionSharePanelProps, 'dimension' | 'filters' | 'share'>) {
  const copy = DEVICES_DIMENSION_COPY[dimension];
  const source = SHARE_OF_COPY[share].source;
  const breakdown = useBreakdown({ ...filters, source, dimension, limit: BREAKDOWN_LIMIT_MAX });
  const dto = breakdown.data;
  return (
    <QueryState
      query={breakdown}
      skeleton={<ListSkeleton />}
      isEmpty={dto?.items.length === 0}
      empty={<EmptyState title={`No ${copy.title.toLowerCase()} data in this window`} />}
    >
      {() => (
        <div className="space-y-2">
          <ProportionTable
            caption={`${copy.title}: all values`}
            rows={withRemainder(breakdownRows(dto!), dto!.total)}
            unit={UNIT_OF_SOURCE[dto!.source]}
            valueHeader={copy.title}
          />
          {isCappedBreakdown(dto!) ? (
            <p className="text-2xs text-muted-foreground">
              Only the {BREAKDOWN_LIMIT_MAX} most common values are listed; the rest are added up in
              the last row.
            </p>
          ) : null}
        </div>
      )}
    </QueryState>
  );
}
