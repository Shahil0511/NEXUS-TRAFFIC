import { LINKABLE_DEVICE_CLASSES } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { DEVICE_CLASSES } from '../enrichment/user-agent.parser';
import {
  IDENTIFIED_SQL,
  LINKABLE_SQL,
  LINKED_SQL,
  PAGE_VIEW_LINKED_SQL,
} from './coverage-predicates';

describe('coverage predicates', () => {
  it('LINKABLE_DEVICE_CLASSES ⊆ the device classes the UA parser stores', () => {
    const stored: readonly string[] = Object.values(DEVICE_CLASSES);
    for (const device of LINKABLE_DEVICE_CLASSES) expect(stored).toContain(device);
  });

  it('identified = a verified user on the given alias', () => {
    expect(IDENTIFIED_SQL('h')).toBe('h.user_key IS NOT NULL');
  });

  it('linkable = http calls from browser-capable devices only (no SSR, bots, streams)', () => {
    expect(LINKABLE_SQL('r')).toBe(
      "(r.kind = 'http' AND r.ua_device IN ('desktop', 'mobile', 'tablet'))",
    );
  });

  it('linked / page-view-linked are linkable rows carrying the tracker header', () => {
    expect(LINKED_SQL('e')).toBe(`(${LINKABLE_SQL('e')} AND e.session_id IS NOT NULL)`);
    expect(PAGE_VIEW_LINKED_SQL('e')).toBe(`(${LINKABLE_SQL('e')} AND e.page_view_id IS NOT NULL)`);
  });

  it('never contains a placeholder (literals only, safe to inline)', () => {
    for (const sql of [IDENTIFIED_SQL('x'), LINKED_SQL('x'), PAGE_VIEW_LINKED_SQL('x')]) {
      expect(sql).not.toMatch(/\$\d/);
    }
  });
});
