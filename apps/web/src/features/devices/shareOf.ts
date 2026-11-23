/**
 * What the Devices & places page counts, and what it SAYS about it.
 *
 * WHY one table: the "Show share of" switch decides which source ROUTES.overview.breakdown reads
 * (browser page views or server requests) and which unit every bar label prints. The server
 * source has fewer columns (SERVER_BREAKDOWN_DIMENSION_VALUES), so a dimension it lacks is shown
 * greyed out instead of being asked for (the API would refuse it).
 */
import type { BreakdownDimension, BreakdownDto, IngestSource } from '@nexus/shared';

import type { ProportionRow } from '@/components/proportionShares';
import { breakdownValueLabel, dimensionsFor } from '@/features/breakdowns/breakdownCopy';
import type { GeoMetric } from '@/features/geography/GeoPlacesSection';

export const SHARE_OF_VALUES = ['pageViews', 'requests'] as const;
export type ShareOf = (typeof SHARE_OF_VALUES)[number];

export interface ShareOfCopy {
  /** Switch label. */
  label: string;
  /** Accessible name of the switch option (says what is counted). */
  ariaLabel: string;
  /** The breakdown source it reads. */
  source: IngestSource;
  /** The country chart metric of the Places tab that counts the same thing. */
  geoMetric: GeoMetric;
}

export const SHARE_OF_COPY: Record<ShareOf, ShareOfCopy> = {
  pageViews: {
    label: 'Page views',
    ariaLabel: 'Page views (browser events)',
    source: 'browser',
    geoMetric: 'pageViews',
  },
  requests: {
    label: 'Requests',
    ariaLabel: 'Requests (server events)',
    source: 'server',
    geoMetric: 'requests',
  },
};

/** The plural noun printed inside every bar label, per source ("30% of page views"). */
export const UNIT_OF_SOURCE: Record<IngestSource, string> = {
  browser: 'page views',
  server: 'requests',
};

/** The share-of choice that counts the same thing as a country chart metric (null: none). */
export function shareOfGeoMetric(metric: GeoMetric): ShareOf | null {
  return SHARE_OF_VALUES.find((share) => SHARE_OF_COPY[share].geoMetric === metric) ?? null;
}

/** The country metrics the Places tab may switch to (the ones the share-of switch offers). */
export const PLACES_GEO_METRICS: readonly GeoMetric[] = SHARE_OF_VALUES.map(
  (share) => SHARE_OF_COPY[share].geoMetric,
);

/** Whether ROUTES.overview.breakdown has `dimension` for the share-of choice's source. */
export function isDimensionAvailable(dimension: BreakdownDimension, share: ShareOf): boolean {
  return dimensionsFor(SHARE_OF_COPY[share].source).includes(dimension);
}

// ─── Dimensions shown on the page ────────────────────────────────────────────

/** "Devices & browsers" tab, in reading order. */
export const DEVICE_DIMENSIONS = [
  'device',
  'browser',
  'os',
  'release',
] as const satisfies readonly BreakdownDimension[];
/** "Places" tab (what the browser itself says about where it is). */
export const PLACE_DIMENSIONS = [
  'client_tz',
  'client_lang',
] as const satisfies readonly BreakdownDimension[];

export type DevicesPageDimension =
  (typeof DEVICE_DIMENSIONS)[number] | (typeof PLACE_DIMENSIONS)[number];

export interface DevicesDimensionCopy {
  /** Panel title and the value column header. */
  title: string;
  /** One line under the title. */
  description: string;
}

export const DEVICES_DIMENSION_COPY: Record<DevicesPageDimension, DevicesDimensionCopy> = {
  device: { title: 'Device type', description: 'Desktop, mobile or tablet' },
  browser: { title: 'Browser', description: 'The browser that sent it' },
  os: { title: 'Operating system', description: 'The system the browser runs on' },
  release: { title: 'App version', description: 'The release tag the app sends' },
  client_tz: { title: 'Time zone', description: 'The time zone the browser is set to' },
  client_lang: { title: 'Language', description: 'The language the browser is set to' },
};

/**
 * The bars of one breakdown: a known value's name, "Not sent" (muted) for null, otherwise the
 * INGESTED value as text. Keyed apart so null ('') never collides with a real value.
 */
export function breakdownRows(breakdown: BreakdownDto): ProportionRow[] {
  return breakdown.items.map((item) => ({
    key: item.value === null ? '' : `v:${item.value}`,
    label: breakdownValueLabel(breakdown.dimension, item.value),
    muted: item.value === null,
    count: item.events,
    share: item.share,
  }));
}
