'use client';

import type { GeoCityDto, GeoCountryDto } from '@nexus/shared';
import { BookOpen, MapPin, Network } from 'lucide-react';
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { RankedBarChart, type RankedBar } from '@/components/charts/RankedBarChart';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { EMPTY_VALUE, formatCountry, formatInteger, formatWindowCaption } from '@/lib/format';
import { guideHref } from '@/lib/guide';

import { useGeoCities } from './useGeoCities';
import { useGeoCountries } from './useGeoCountries';

/** Rows fetched per table (the API ranks by requests). */
const GEO_LIMIT = 100;
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
  { value: 'requests', label: 'Requests', ariaLabel: 'Rank by API requests' },
  { value: 'pageViews', label: 'Page views', ariaLabel: 'Rank by page views' },
  { value: 'users', label: 'Users', ariaLabel: 'Rank by verified users' },
];

const METRIC_LABELS: Record<GeoMetric, string> = {
  requests: 'Requests',
  pageViews: 'Page views',
  users: 'Users',
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
 * The first metric (in METRIC_OPTIONS order) with any data, other than `current` (pure;
 * unit-tested); null when every other metric is 0 too. WHY: an empty chart for the chosen metric
 * (page views of an API-only app) offers a switch to a metric that has something to rank.
 */
export function metricWithData(
  countries: readonly GeoCountryDto[],
  current: GeoMetric,
): GeoMetric | null {
  return (
    GEO_METRIC_VALUES.find(
      (metric) => metric !== current && countries.some((country) => country[metric] > 0),
    ) ?? null
  );
}

/** Empty-chart copy per metric: the traffic exists, this metric is 0 everywhere. */
const NO_METRIC_COPY: Record<GeoMetric, { title: string; description: string }> = {
  requests: {
    title: 'No API requests in this window',
    description: 'API requests are sent by the server SDK; this traffic has none.',
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
    header: 'Requests',
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
    header: 'Requests',
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

/**
 * The Geography page: where traffic comes from — a ranked country chart (requests, page views or
 * verified users), the country table and an APPROXIMATE city table, with the GeoLite2 attribution.
 * No map in v1: a ranked bar reads more precisely than shaded areas.
 */
export function GeographyView() {
  const { filters } = useGlobalFilters();
  const countries = useGeoCountries({ ...filters, limit: GEO_LIMIT });
  const cities = useGeoCities({ ...filters, limit: GEO_LIMIT });
  const [metric, setMetric] = useGeoMetric();
  const unlocated = isAllUnlocated(countries.data?.items);
  const bars = useMemo(
    () => countryBars(countries.data?.items ?? [], metric),
    [countries.data, metric],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geography"
        description={
          countries.data
            ? formatWindowCaption(countries.data.window)
            : 'Where API calls and page views come from'
        }
      />

      {unlocated ? (
        <UnlocatedNotice totals={countries.data?.items ?? []} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
            <Panel
              title="Top countries"
              description={`${METRIC_LABELS[metric]} · top ${CHART_BARS}`}
              className="lg:col-span-3"
              aside={
                <SegmentedControl
                  ariaLabel="Rank countries by"
                  value={metric}
                  options={METRIC_OPTIONS}
                  onValueChange={setMetric}
                />
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
                      switchTo={metricWithData(countries.data.items, metric)}
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

            <Panel title="Countries" className="lg:col-span-2" contentClassName="px-0 pb-0">
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
            description="City-level location is an estimate from the IP address (GeoLite2 city centroids)"
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
            Show {METRIC_LABELS[switchTo].toLowerCase()}
          </Button>
        ) : null
      }
    />
  );
}

// ─── No location at all ──────────────────────────────────────────────────────

/**
 * WHY: when every request comes from a private, loopback or unresolvable IP, empty charts look like
 * a broken page. This says what happened in plain words first (company network, or a proxy that
 * hides the visitor's address), the technical cause second, and links to the guide chapter that
 * shows how to forward the client IP.
 */
function UnlocatedNotice({ totals }: { totals: readonly GeoCountryDto[] }) {
  const requests = totals.reduce((sum, row) => sum + row.requests, 0);
  const pageViews = totals.reduce((sum, row) => sum + row.pageViews, 0);
  return (
    <Panel title="Location unavailable">
      <EmptyState
        icon={Network}
        title="None of this traffic could be located"
        description={
          <>
            All visits in this window ({formatInteger(requests)} requests,{' '}
            {formatInteger(pageViews)} page views) came from inside the company network, or through
            a proxy that hides the visitor&apos;s address, so there is no location to show.
            <span className="mt-1.5 block">
              Technically: the IP addresses were private, loopback or unknown. Location needs the
              visitor&apos;s public IP, which a reverse proxy must forward (X-Forwarded-For).
            </span>
          </>
        }
        action={
          <Button asChild variant="outline" size="sm">
            <a href={guideHref('clientIp')} target="_blank" rel="noreferrer noopener">
              <BookOpen aria-hidden="true" /> How to forward the client IP
            </a>
          </Button>
        }
      />
    </Panel>
  );
}
