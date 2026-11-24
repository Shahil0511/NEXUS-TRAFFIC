'use client';

import { PageHeader } from '@/components/PageHeader';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatWindowCaption } from '@/lib/format';

import { GEO_LIMIT, GeoPlacesSection } from './GeoPlacesSection';
import { useGeoCountries } from './useGeoCountries';

/**
 * The Geography page (PAGES.geography, kept so old links work; the sidebar's "Devices & places"
 * item covers it): the places content on its own, with its own "Show countries by" control. The
 * same content is the Places tab of PAGES.devices (features/devices/DevicesView.tsx).
 */
export function GeographyView() {
  const { filters } = useGlobalFilters();
  // Same query key as the section's own call, so React Query sends ONE request.
  const countries = useGeoCountries({ ...filters, limit: GEO_LIMIT });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices & places"
        description={
          countries.data
            ? formatWindowCaption(countries.data.window)
            : 'Where API calls and page views come from'
        }
      />
      <GeoPlacesSection filters={filters} />
    </div>
  );
}
