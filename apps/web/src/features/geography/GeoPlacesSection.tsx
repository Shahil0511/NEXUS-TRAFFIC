'use client';

import type { GeoCityDto, GeoCountryDto, TimeWindowQuery } from '@nexus/shared';
import { BookOpen, ChartColumn, Flag, MapPin, Network, PlugZap } from 'lucide-react';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback, useMemo, type ReactNode } from 'react';

import { RankedBarChart, type RankedBar } from '@/components/charts/RankedBarChart';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { EMPTY_VALUE, formatCountry, formatInteger } from '@/lib/format';
import { guideHref } from '@/lib/guide';
import { METRIC_COPY } from '@/lib/metricCopy';
import { PAGES } from '@/lib/pages';

import { useGeoCities } from './useGeoCities';
import { useGeoCountries } from './useGeoCountries';

/** Rows fetched per table (the API ranks by requests). */
export const GEO_LIMIT = 100;
const CHART_BARS = 10;
/** Required attribution of the GeoLite2 data (MaxMind licence); a constant, never ingested. */
const MAXMIND_URL = 'https://www.maxmind.com';

export const GEO_METRIC_VALUES = ['requests', 'pageViews', 'users'] as const;
export type GeoMetric = (typeof GEO_METRIC_VALUES)[number];

/**
 * The chart metric as URL state (`?metric=`), like every other list param: a "ranked by users"
 * view survives a reload and can be shared. Unknown values fall back to requests.
 */
export const geoParsers = {
  metric: parseAsStringLiteral(GEO_METRIC_VALUES).withDefault('requests'),
};

function useGeoMetric(): [GeoMetric, (metric: GeoMetric) => void] {
  const [raw, setRaw] = useQueryStates(geoParsers);
  const setMetric = useCallback((metric: GeoMetric) => void setRaw({ metric }), [setRaw]);
  return [raw.metric, setMetric];
}

const METRIC_OPTIONS: readonly SegmentedOption<GeoMetric>[] = [
  { value: 'requests', label: 'API calls', ariaLabel: 'Show by API calls' },
  { value: 'pageViews', label: 'Page views', ariaLabel: 'Show by page views' },
  { value: 'users', label: 'Users', ariaLabel: 'Show by verified people' },
];

const METRIC_LABELS: Record<GeoMetric, string> = {
  requests: METRIC_COPY.requests.label,
  pageViews: 'Page views',
  users: 'Users',
};

/** The same metric inside a sentence ("Show API calls"): lower case except the acronym. */
const METRIC_NOUNS: Record<GeoMetric, string> = {
  requests: METRIC_COPY.requests.label,
  pageViews: 'page views',
  users: 'users',
};

/** Top countries by the chosen metric; zero rows are dropped (they would be empty bars). */
export function countryBars(
  countries: readonly GeoCountryDto[],
  metric: GeoMetric,
  limit = CHART_BARS,
): RankedBar[] {
  return countries
    .filter((country) => country[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit)
    .map((country) => ({
      key: country.country ?? 'unknown',
      label: formatCountry(country.country),
      value: country[metric],
    }));
}

/**
 * The first metric (in `candidates` order) with any data, other than `current` (pure;
 * unit-tested); null when every other metric is 0 too. WHY: an empty chart for the chosen metric
 * (page views of an API-only app) offers a switch to a metric that has something to rank.
 */
export function metricWithData(
  countries: readonly GeoCountryDto[],
  current: GeoMetric,
  candidates: readonly GeoMetric[] = GEO_METRIC_VALUES,
): GeoMetric | null {
  return (
    candidates.find(
      (metric) => metric !== current && countries.some((country) => country[metric] > 0),
    ) ?? null
  );
}

/** Empty-chart copy per metric: the traffic exists, this metric is 0 everywhere. */
const NO_METRIC_COPY: Record<GeoMetric, { title: string; description: string }> = {
  requests: {
    title: 'No API calls in this window',
    description: 'API calls are sent by the server SDK; this traffic has none.',
  },
  pageViews: {
    title: 'No page views in this window',
    description: 'Page views are sent by the browser snippet; this traffic has none.',
  },
  users: {
    title: 'No verified users in this window',
    description: 'Users are counted only when an app sends verified identities.',
  },
};

/** "Nothing at all in this window" — shared by the chart and the country table. */
const NO_TRAFFIC_DESCRIPTION = 'Nothing was recorded for the selected app and range.';

/**
 * True when there IS traffic but none of it could be located (pure; unit-tested). WHY: on an
 * internal deployment every IP is private/loopback, and "Unknown 100 %" charts read like a bug —
 * the page explains the cause instead.
 */
export function isAllUnlocated(countries: readonly GeoCountryDto[] | undefined): boolean {
  return (
    countries !== undefined &&
    countries.length > 0 &&
    countries.every((country) => country.country === null)
  );
}

function cityKey(city: GeoCityDto): string {
  return `${city.country ?? ''}|${city.region ?? ''}|${city.city ?? ''}`;
}

const COUNTRY_COLUMNS: DataTableColumn<GeoCountryDto>[] = [
  {
    id: 'country',
    header: 'Country',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground">
          {row.country ?? EMPTY_VALUE}
        </span>
        <span className="truncate">{formatCountry(row.country)}</span>
      </span>
    ),
  },
  {
    id: 'requests',
    header: METRIC_COPY.requests.label,
    align: 'right',
    cell: (row) => formatInteger(row.requests),
  },
  {
    id: 'pageViews',
    header: 'Page views',
    align: 'right',
    cell: (row) => formatInteger(row.pageViews),
  },
  { id: 'users', header: 'Users', align: 'right', cell: (row) => formatInteger(row.users) },
];

const CITY_COLUMNS: DataTableColumn<GeoCityDto>[] = [
  {
    id: 'city',
    header: 'City',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate">{row.city ?? 'Unknown city'}</span>
        {row.region ? (
          <span className="block truncate text-2xs text-muted-foreground">{row.region}</span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'country',
    header: 'Country',
    cell: (row) => <span className="whitespace-nowrap">{formatCountry(row.country)}</span>,
  },
  {
    id: 'requests',
    header: METRIC_COPY.requests.label,
    align: 'right',
    cell: (row) => formatInteger(row.requests),
  },
  {
    id: 'pageViews',
    header: 'Page views',
    align: 'right',
    cell: (row) => formatInteger(row.pageViews),
  },
  { id: 'users', header: 'Users', align: 'right', cell: (row) => formatInteger(row.users) },
];

export interface GeoPlacesSectionProps {
  /** The page's filters (app, range, environment). */
  filters: TimeWindowQuery;
  /**
   * Controlled chart metric (the Devices & places "Show share of" switch). Absent: the section
   * keeps its own `?metric=` and shows its own "Show countries by" control.
   */
  metric?: GeoMetric;
  onMetricChange?: (metric: GeoMetric) => void;
  /** The metrics a controlled section may switch to from an empty chart. */
  metricChoices?: readonly GeoMetric[];
  /** Extra line in the "no location" notice (e.g. what the page shows meanwhile). */
  meanwhile?: ReactNode;
}

/**
 * WHY: where traffic comes from — a country bar chart (requests, page views or verified
 * users), the country table and an APPROXIMATE city table, with the GeoLite2 attribution. Used by
 * the Geography page and the Places tab of Devices & places. No map in v1: a ranked bar reads
 * more precisely than shaded areas.
 */
export function GeoPlacesSection({
  filters,
  metric: controlledMetric,
  onMetricChange,
  metricChoices = GEO_METRIC_VALUES,
  meanwhile,
}: GeoPlacesSectionProps) {
  const countries = useGeoCountries({ ...filters, limit: GEO_LIMIT });
  const cities = useGeoCities({ ...filters, limit: GEO_LIMIT });
  const [urlMetric, setUrlMetric] = useGeoMetric();
  const controlled = controlledMetric !== undefined;
  const metric = controlledMetric ?? urlMetric;
  const setMetric = onMetricChange ?? setUrlMetric;
  const unlocated = isAllUnlocated(countries.data?.items);
  const bars = useMemo(
    () => countryBars(countries.data?.items ?? [], metric),
    [countries.data, metric],
  );

  return (
    <div className="space-y-6">
      {unlocated ? (
        <UnlocatedNotice totals={countries.data?.items ?? []} meanwhile={meanwhile} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
            <Panel
              title="Top countries"
              icon={ChartColumn}
              description={`${METRIC_LABELS[metric]} · top ${CHART_BARS}`}
              className="lg:col-span-3"
              aside={
                controlled ? null : (
                  <SegmentedControl
                    ariaLabel="Show countries by"
                    value={metric}
                    options={METRIC_OPTIONS}
                    onValueChange={setMetric}
                  />
                )
              }
            >
              <QueryState
                query={countries}
                skeleton={<ChartSkeleton />}
                isEmpty={bars.length === 0}
                empty={
                  countries.data?.items.length ? (
                    <NoMetricState
                      metric={metric}
                      switchTo={metricWithData(countries.data.items, metric, metricChoices)}
                      onSwitch={setMetric}
                    />
                  ) : (
                    <EmptyState
                      title="No traffic in this window"
                      description={NO_TRAFFIC_DESCRIPTION}
                      action={<WidenRangeButton />}
                    />
                  )
                }
              >
                {() => (
                  <RankedBarChart
                    bars={bars}
                    seriesLabel={METRIC_LABELS[metric]}
                    ariaLabel={`${METRIC_LABELS[metric]} per country`}
                    format={formatInteger}
                  />
                )}
              </QueryState>
            </Panel>

            <Panel
              title="Countries"
              icon={Flag}
              className="lg:col-span-2"
              contentClassName="px-0 pb-0"
            >
              {countries.isError ? (
                <ErrorState error={countries.error} onRetry={() => void countries.refetch()} />
              ) : (
                <DataTable
                  caption="Countries"
                  columns={COUNTRY_COLUMNS}
                  rows={countries.data?.items}
                  rowKey={(row) => row.country ?? 'unknown'}
                  loading={countries.isPending}
                  empty={
                    <EmptyState
                      title="No traffic in this window"
                      description={NO_TRAFFIC_DESCRIPTION}
                      action={<WidenRangeButton />}
                    />
                  }
                />
              )}
            </Panel>
          </div>

          <Panel
            title="Cities"
            icon={MapPin}
            description="City is estimated from the IP address"
            contentClassName="px-0 pb-0"
            aside={
              <Badge variant="warning" title="Cities are estimated from IP addresses">
                <MapPin aria-hidden="true" />
                approximate
              </Badge>
            }
          >
            {cities.isError ? (
              <ErrorState error={cities.error} onRetry={() => void cities.refetch()} />
            ) : (
              <DataTable
                caption="Cities (approximate)"
                columns={CITY_COLUMNS}
                rows={cities.data?.items}
                rowKey={cityKey}
                loading={cities.isPending}
                empty={
                  <EmptyState
                    title="No located cities in this window"
                    description="A city is shown only when the visitor's IP address resolves to one."
                  />
                }
              />
            )}
          </Panel>
        </>
      )}

      <p className="text-2xs text-muted-foreground">
        This product includes GeoLite2 data created by MaxMind, available from{' '}
        <a
          href={MAXMIND_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {MAXMIND_URL}
        </a>
        .
      </p>
    </div>
  );
}

// ─── Empty chart for one metric ──────────────────────────────────────────────

/**
 * WHY: traffic exists but the chosen metric is 0 everywhere (page views of an API-only app). That
 * is not a location problem, so say which metric is empty and offer the one that has data.
 */
function NoMetricState({
  metric,
  switchTo,
  onSwitch,
}: {
  metric: GeoMetric;
  switchTo: GeoMetric | null;
  onSwitch: (metric: GeoMetric) => void;
}) {
  const copy = NO_METRIC_COPY[metric];
  return (
    <EmptyState
      title={copy.title}
      description={copy.description}
      action={
        switchTo ? (
          <Button variant="outline" size="sm" onClick={() => onSwitch(switchTo)}>
            Show {METRIC_NOUNS[switchTo]}
          </Button>
        ) : null
      }
    />
  );
}

// ─── No location at all ──────────────────────────────────────────────────────

/**
 * WHY: when every request comes from a private, loopback or unresolvable IP, empty charts look like
 * a broken page. This says the status in plain words first (we cannot tell where people are),
 * then the cause (every request reaches Nexus from the gateway's internal address), then the
 * technical detail, and links to Data health and to the guide chapter on forwarding the client IP.
 */
function UnlocatedNotice({
  totals,
  meanwhile,
}: {
  totals: readonly GeoCountryDto[];
  meanwhile?: ReactNode;
}) {
  const requests = totals.reduce((sum, row) => sum + row.requests, 0);
  const pageViews = totals.reduce((sum, row) => sum + row.pageViews, 0);
  return (
    <Panel title="Location unavailable">
      <EmptyState
        icon={Network}
        title="We cannot tell where people are yet"
        description={
          <>
            Every request in this window ({formatInteger(requests)} requests,{' '}
            {formatInteger(pageViews)} page views) reached Nexus from the gateway&apos;s internal
            address, so there is no visitor address to locate.
            <span className="mt-1.5 block">
              Technically: the IP addresses were private, loopback or unknown. Location needs the
              visitor&apos;s public IP, which the gateway must forward (X-Forwarded-For).
            </span>
            {meanwhile ? <span className="mt-1.5 block">{meanwhile}</span> : null}
          </>
        }
        action={
          <span className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={PAGES.integration()}>
                <PlugZap aria-hidden="true" /> Open Data health
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={guideHref('clientIp')} target="_blank" rel="noreferrer noopener">
                <BookOpen aria-hidden="true" /> How to forward the client IP
              </a>
            </Button>
          </span>
        }
      />
    </Panel>
  );
}
