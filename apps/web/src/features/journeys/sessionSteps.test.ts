import type { SessionEventDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { sessionEvent } from '@/test/fixtures';

import { groupSessionSteps } from './sessionSteps';

function ids(events: readonly SessionEventDto[]): string[] {
  return events.map((event) => event.eventId);
}

describe('groupSessionSteps', () => {
  it('nests tools and API calls under the page view they followed', () => {
    const steps = groupSessionSteps([
      sessionEvent('p1', 'page_view'),
      sessionEvent('t1', 'tool_use'),
      sessionEvent('a1', 'api'),
      sessionEvent('p2', 'page_view'),
      sessionEvent('c1', 'custom'),
    ]);
    expect(steps.map((step) => step.page?.eventId)).toEqual(['p1', 'p2']);
    expect(ids(steps[0]!.events)).toEqual(['t1', 'a1']);
    expect(ids(steps[1]!.events)).toEqual(['c1']);
  });

  it('keeps events before the first page view in a leading step without a page', () => {
    const steps = groupSessionSteps([sessionEvent('a0', 'api'), sessionEvent('p1', 'page_view')]);
    expect(steps[0]).toEqual({ page: null, events: [expect.objectContaining({ eventId: 'a0' })] });
    expect(steps[1]?.page?.eventId).toBe('p1');
  });

  it('returns no steps for no events', () => {
    expect(groupSessionSteps([])).toEqual([]);
  });
});
