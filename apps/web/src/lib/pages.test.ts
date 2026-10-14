import fs from 'node:fs';
import path from 'node:path';

import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_ITEMS, pageFiltersFor } from './nav';
import { PAGES, withQuery } from './pages';

const PAGES_FILE = path.join(__dirname, 'pages.ts');

describe('PAGES', () => {
  it('builds basePath-relative hrefs (Next adds /traffic)', () => {
    expect(PAGES.overview()).toBe('/');
    expect(PAGES.endpoints()).toBe('/endpoints');
    expect(PAGES.noAccess()).toBe('/no-access');
  });

  it('encodes dynamic segments', () => {
    expect(PAGES.endpointDetail('6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11')).toBe(
      '/endpoints/6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11',
    );
    expect(PAGES.endpointDetail('../x?y')).toBe('/endpoints/..%2Fx%3Fy');
    expect(PAGES.userDetail('ab12')).toBe('/users/ab12');
    expect(PAGES.sessionDetail('ebo-sales', '7c1d2e3f-0000-4000-8000-000000000001')).toBe(
      '/journeys/ebo-sales/7c1d2e3f-0000-4000-8000-000000000001',
    );
  });

  it('appends only non-empty query values', () => {
    expect(withQuery('/errors', { app: 'ebo-sales', range: undefined, to: '' })).toBe(
      '/errors?app=ebo-sales',
    );
    expect(withQuery('/errors', {})).toBe('/errors');
  });

  it('has an @see pointing at an existing page file for every builder', () => {
    const source = fs.readFileSync(PAGES_FILE, 'utf8');
    const targets = [...source.matchAll(/@see (\.\.\/app\/\S+page\.tsx)/g)].map((m) => m[1]!);
    expect(targets.length).toBe(Object.keys(PAGES).length);
    for (const target of targets) {
      expect(fs.existsSync(path.join(path.dirname(PAGES_FILE), target)), target).toBe(true);
    }
  });
});

describe('NAV_ITEMS', () => {
  it('links only to PAGES hrefs', () => {
    const hrefs = new Set(
      Object.values(PAGES).map((build) => (build as (id: string) => string)('x')),
    );
    for (const item of NAV_ITEMS) expect(hrefs.has(item.href), item.id).toBe(true);
  });

  it('marks the overview active only on "/" and sections by prefix', () => {
    const byId = (id: string) => NAV_ITEMS.find((item) => item.id === id)!;
    expect(isNavItemActive(byId('overview'), '/')).toBe(true);
    expect(isNavItemActive(byId('overview'), '/endpoints')).toBe(false);
    expect(isNavItemActive(byId('endpoints'), '/endpoints/abc')).toBe(true);
    expect(isNavItemActive(byId('endpoints'), '/endpointsX')).toBe(false);
    expect(isNavItemActive(byId('pages'), '/tools')).toBe(true);
  });
});

describe('pageFiltersFor', () => {
  it('shows only the filters a page reads, with its range cap (detail pages inherit)', () => {
    expect(pageFiltersFor('/')).toEqual({
      app: true,
      range: true,
      maxRangeMs: MAX_PERCENTILE_RANGE_MS,
    });
    expect(pageFiltersFor('/users/abc').maxRangeMs).toBe(MAX_COUNT_RANGE_MS);
    expect(pageFiltersFor('/live')).toMatchObject({ range: false });
    expect(pageFiltersFor('/applications/ebo-sales')).toMatchObject({ app: false, range: true });
    expect(pageFiltersFor('/apps')).toMatchObject({ app: false, range: false });
  });

  it('does not confuse /applications with /apps', () => {
    const apps = NAV_ITEMS.find((item) => item.id === 'apps')!;
    expect(isNavItemActive(apps, '/applications')).toBe(false);
  });
});
