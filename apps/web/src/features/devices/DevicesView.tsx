'use client';

import type { TimeWindowQuery } from '@nexus/shared';
import { Globe2, MonitorSmartphone } from 'lucide-react';
import { useCallback } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeviceReturnPanel } from '@/features/breakdowns/DeviceReturnPanel';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { GeoPlacesSection, type GeoMetric } from '@/features/geography/GeoPlacesSection';

import { DEVICES_TAB_VALUES, useDevicesParams, type DevicesTab } from './devicesParams';
import { DimensionSharePanel } from './DimensionSharePanel';
import {
  DEVICE_DIMENSIONS,
  PLACE_DIMENSIONS,
  PLACES_GEO_METRICS,
  SHARE_OF_COPY,
  SHARE_OF_VALUES,
  shareOfGeoMetric,
  UNIT_OF_SOURCE,
  type ShareOf,
} from './shareOf';

const SHARE_OPTIONS: readonly SegmentedOption<ShareOf>[] = SHARE_OF_VALUES.map((share) => ({
  value: share,
  label: SHARE_OF_COPY[share].label,
  ariaLabel: SHARE_OF_COPY[share].ariaLabel,
}));

const TAB_LABELS: Record<DevicesTab, string> = {
  devices: 'Devices & browsers',
  places: 'Places',
};

function isDevicesTab(value: string): value is DevicesTab {
  return (DEVICES_TAB_VALUES as readonly string[]).includes(value);
}

/**
 * The Devices & places page (PAGES.devices): what people connect with and from where, as shares
 * of ONE unit chosen in the "Show share of" switch (page views or requests). Two tabs, both in
 * the URL: "Devices & browsers" (device type, browser, operating system, app version, first-time
 * vs returning devices) and "Places" (time zone, language, countries, cities). Totals only.
 */
export function DevicesView() {
  const { filters } = useGlobalFilters();
  const { tab, share, setTab, setShare } = useDevicesParams();
  const showPageViews = useCallback(() => setShare('pageViews'), [setShare]);
  const unit = UNIT_OF_SOURCE[SHARE_OF_COPY[share].source];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices & places"
        description={`Every bar is a share of ${unit} in the selected range.`}
        actions={
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              Show share of
            </span>
            <SegmentedControl
              ariaLabel="Show share of"
              value={share}
              options={SHARE_OPTIONS}
              onValueChange={setShare}
            />
          </span>
        }
      />

      <Tabs value={tab} onValueChange={(value) => isDevicesTab(value) && setTab(value)}>
        <TabsList aria-label="Devices and places">
          <TabsTrigger value="devices">
            <MonitorSmartphone aria-hidden="true" /> {TAB_LABELS.devices}
          </TabsTrigger>
          <TabsTrigger value="places">
            <Globe2 aria-hidden="true" /> {TAB_LABELS.places}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="devices">
          <DevicesTabContent filters={filters} share={share} onUsePageViews={showPageViews} />
        </TabsContent>
        <TabsContent value="places">
          <PlacesTabContent
            filters={filters}
            share={share}
            onUsePageViews={showPageViews}
            onShareChange={setShare}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TabContentProps {
  filters: TimeWindowQuery;
  share: ShareOf;
  onUsePageViews: () => void;
}

/** Device type, browser, operating system, app version, then the first-time devices panel. */
function DevicesTabContent({ filters, share, onUsePageViews }: TabContentProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {DEVICE_DIMENSIONS.map((dimension) => (
        <DimensionSharePanel
          key={dimension}
          dimension={dimension}
          filters={filters}
          share={share}
          onUsePageViews={onUsePageViews}
        />
      ))}
      <DeviceReturnPanel filters={filters} title="First-time vs returning devices" />
    </div>
  );
}

/**
 * Time zone and language (what the browser says), then countries and cities from the address.
 * The country chart counts the same unit as the share-of switch.
 */
function PlacesTabContent({
  filters,
  share,
  onUsePageViews,
  onShareChange,
}: TabContentProps & { onShareChange: (share: ShareOf) => void }) {
  const onMetricChange = useCallback(
    (metric: GeoMetric) => {
      const next = shareOfGeoMetric(metric);
      if (next) onShareChange(next);
    },
    [onShareChange],
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {PLACE_DIMENSIONS.map((dimension) => (
          <DimensionSharePanel
            key={dimension}
            dimension={dimension}
            filters={filters}
            share={share}
            onUsePageViews={onUsePageViews}
          />
        ))}
      </div>
      <GeoPlacesSection
        filters={filters}
        metric={SHARE_OF_COPY[share].geoMetric}
        onMetricChange={onMetricChange}
        metricChoices={PLACES_GEO_METRICS}
        meanwhile="Meanwhile, the time zone above shows what the browsers are set to."
      />
    </div>
  );
}
