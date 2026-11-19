'use client';

import type { TimeWindowQuery } from '@nexus/shared';

import { BreakdownPanel } from '@/features/breakdowns/BreakdownPanel';
import { DeviceReturnPanel } from '@/features/breakdowns/DeviceReturnPanel';

/**
 * WHY: one app's audience — do people come back (new vs returning devices), on what (browser,
 * OS, device, language, time zone, referrer) and on which build (release, navigation, environment).
 * Every panel reads the page's filters, so it is scoped to the app, range and environment.
 */
export function ApplicationAudienceSection({ filters }: { filters: TimeWindowQuery }) {
  return (
    <section aria-label="Audience" className="grid gap-4 lg:grid-cols-3">
      <DeviceReturnPanel filters={filters} />
      <BreakdownPanel
        title="Browsers and devices"
        filters={filters}
        dimensions={['browser', 'os', 'device', 'client_lang', 'client_tz', 'referrer_host']}
      />
      <BreakdownPanel
        title="Releases and navigation"
        filters={filters}
        dimensions={['release', 'nav', 'time_reason', 'environment']}
      />
    </section>
  );
}
