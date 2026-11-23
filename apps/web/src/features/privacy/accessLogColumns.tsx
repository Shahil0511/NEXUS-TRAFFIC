import type { PersonAccessEntryDto, PersonAccessSurface } from '@nexus/shared';
import { Filter } from 'lucide-react';
import Link from 'next/link';

import type { DataTableColumn } from '@/components/DataTable';
import { RelativeTime } from '@/components/RelativeTime';
import { Button } from '@/components/ui/button';
import type { UserDetailTab } from '@/features/users/userDetailParams';
import { formatDateTime } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

/**
 * Which part was opened, in the words of the page that shows it: a person-page tab, or a list
 * narrowed to the person (Visits, Failed requests).
 */
export const SURFACE_LABELS: Record<PersonAccessSurface, string> = {
  person_profile: 'Summary',
  person_timeline: 'Activity',
  person_devices: 'Devices',
  person_daily: 'Daily activity',
  person_visits: 'Visits',
  person_failures: 'Failed requests',
};

/** The person-page tab (`?tab=`) of each surface, or the list page narrowed by `?userKey=`. */
const SURFACE_PLACES: Record<PersonAccessSurface, UserDetailTab | 'journeys' | 'errors'> = {
  person_profile: 'summary',
  person_timeline: 'activity',
  person_devices: 'devices',
  person_daily: 'daily',
  person_visits: 'journeys',
  person_failures: 'errors',
};

/**
 * Where the recorded part lives: PAGES.userDetail(userKey) on its tab (Summary is the default, no
 * param), or the Journeys / Errors list narrowed to the person. Built from the opaque key only.
 */
export function personPartHref(entry: PersonAccessEntryDto): string {
  const place = SURFACE_PLACES[entry.surface];
  const userKey = entry.subjectUserKey;
  if (place === 'journeys') return withQuery(PAGES.journeys(), { userKey });
  if (place === 'errors') return withQuery(PAGES.errors(), { userKey });
  return withQuery(PAGES.userDetail(userKey), {
    tab: place === 'summary' ? undefined : place,
  });
}

const LINK_CLASS =
  'rounded-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60';

/**
 * WHY: one row reads "when, which admin, whose page (masked), which part". Links are built ONLY
 * from the opaque userKey (PAGES), never from an email.
 */
export function accessLogColumns(
  showPerson: (userKey: string) => void,
  filtered: boolean,
): DataTableColumn<PersonAccessEntryDto>[] {
  return [
    {
      id: 'when',
      header: 'When (IST)',
      cell: (row) => (
        <span className="flex flex-col">
          <time dateTime={row.viewedAt}>{formatDateTime(row.viewedAt)}</time>
          <RelativeTime iso={row.viewedAt} className="text-2xs text-muted-foreground" />
        </span>
      ),
    },
    { id: 'admin', header: 'Admin', cell: (row) => row.viewerEmail },
    {
      id: 'person',
      header: 'Person',
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={PAGES.userDetail(row.subjectUserKey)} className={LINK_CLASS}>
            {row.subjectEmailMasked}
          </Link>
          {filtered ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={() => showPerson(row.subjectUserKey)}
            >
              <Filter aria-hidden="true" /> Only this person
              <span className="sr-only"> ({row.subjectEmailMasked})</span>
            </Button>
          )}
        </span>
      ),
    },
    {
      id: 'part',
      header: 'Part of the page',
      cell: (row) => (
        <Link href={personPartHref(row)} className={LINK_CLASS}>
          {SURFACE_LABELS[row.surface]}
          <span className="sr-only"> of {row.subjectEmailMasked}</span>
        </Link>
      ),
    },
  ];
}
