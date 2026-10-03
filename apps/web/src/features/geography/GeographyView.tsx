'use client';

import type { GeoCityDto, GeoCountryDto } from '@nexus/shared';
import { MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';

import { RankedBarChart, type RankedBar } from '@/components/charts/RankedBarChart';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { ChartSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { EMPTY_VALUE, formatCountry, formatInteger, formatWindowCaption } from '@/lib/format';

import { useGeoCities } from './useGeoCities';
import { useGeoCountries } from './useGeoCountries';

/** Rows fetched per table (the API ranks by requests). */
const GEO_LIMIT = 100;
const CHART_BARS = 10;
/** Required attribution of the GeoLite2 data (MaxMind licence); a constant, never ingested. */
const MAXMIND_URL = 'https://www.maxmind.com';

export type GeoMetric = 'requests' | 'pageViews' | 'users';

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
        <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
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
          <span className="block truncate text-[11px] text-muted-foreground">{row.region}</span>
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
  const [metric, setMetric] = useState<GeoMetric>('requests');
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
              <EmptyState
                title="No located traffic"
                description="Nothing in this window came from a public IP address."
              />
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
              empty={<EmptyState title="No traffic in this window" />}
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
            empty={<EmptyState title="No located cities in this window" />}
          />
        )}
      </Panel>

      <p className="text-[11px] text-muted-foreground">
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
