import { PERSON_ACCESS_SURFACE_VALUES, type PersonAccessEntryDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { USER_KEY } from '@/test/fixtures';

import { personPartHref, SURFACE_LABELS } from './accessLogColumns';

function entry(surface: PersonAccessEntryDto['surface']): PersonAccessEntryDto {
  return {
    id: 1,
    viewedAt: '2026-11-24T08:00:00.000Z',
    viewerEmail: 'boss@libas.in',
    subjectUserKey: USER_KEY,
    subjectEmailMasked: 'b***@libas.in',
    surface,
  };
}

describe('access log part labels and places', () => {
  it('names every surface, each with its own label', () => {
    const labels = PERSON_ACCESS_SURFACE_VALUES.map((surface) => SURFACE_LABELS[surface]);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('One day and Usual activity hours open the Daily activity tab', () => {
    expect(SURFACE_LABELS.person_day).toBe('One day');
    expect(SURFACE_LABELS.person_pattern).toBe('Usual activity hours');
    expect(personPartHref(entry('person_day'))).toBe(`/users/${USER_KEY}?tab=daily`);
    expect(personPartHref(entry('person_pattern'))).toBe(`/users/${USER_KEY}?tab=daily`);
  });

  it('Visit steps (no visit id in the row) opens the Visits list narrowed to the person', () => {
    expect(SURFACE_LABELS.person_visit_steps).toBe('Visit steps');
    expect(personPartHref(entry('person_visit_steps'))).toBe(`/journeys?userKey=${USER_KEY}`);
    expect(personPartHref(entry('person_visit_steps'))).toBe(
      personPartHref(entry('person_visits')),
    );
  });
});
