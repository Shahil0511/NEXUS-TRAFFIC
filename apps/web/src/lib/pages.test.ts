import fs from 'node:fs';
import path from 'node:path';

import { MAX_COUNT_RANGE_MS, MAX_PERCENTILE_RANGE_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_ITEMS, NAV_SECTIONS, pageFiltersFor } from './nav';
import { PAGES, withQuery } from './pages';

const PAGES_FILE = path.join(__dirname, 'pages.ts');

describe('PAGES', () => {
  it('builds basePath-relative hrefs (Next adds /traffic)', () => {
    expect(PAGES.overview()).toBe('/');
    expect(PAGES.endpoints()).toBe('/endpoints');
    expect(PAGES.noAccess()).toBe('/no-access');
    expect(PAGES.devices()).toBe('/devices');
    expect(PAGES.geography()).toBe('/geography');
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

  it('points "Devices & places" at /devices and keeps the old /geography link highlighted', () => {
    const devices = NAV_ITEMS.find((item) => item.id === 'devices')!;
    expect(devices.href).toBe(PAGES.devices());
    expect(devices.alsoActiveOn).toEqual([PAGES.geography()]);
    expect(isNavItemActive(devices, PAGES.devices())).toBe(true);
    expect(isNavItemActive(devices, PAGES.geography())).toBe(true);
    expect(isNavItemActive(devices, '/devicesX')).toBe(false);
  });
});

describe('the Privacy & access nav item', () => {
  it('sits in the Setup group, links to PAGES.privacy() and states its purpose', () => {
    const setup = NAV_SECTIONS.find((section) => section.label === 'Setup')!;
    const privacy = setup.items.find((item) => item.id === 'privacy')!;
    expect(PAGES.privacy()).toBe('/privacy');
    expect(privacy).toMatchObject({
      label: 'Privacy & access',
      href: PAGES.privacy(),
      question: 'Who opened whose person page, and when.',
      questionHi: 'Kisne kiska page kab khola.',
    });
    expect(isNavItemActive(privacy, '/privacy')).toBe(true);
    expect(isNavItemActive(privacy, '/privacyX')).toBe(false);
  });

  it('reads no global filter (the log is not windowed)', () => {
    expect(pageFiltersFor('/privacy')).toMatchObject({
      app: false,
      range: false,
      environment: false,
    });
  });
});

describe('pageFiltersFor', () => {
  it('shows only the filters a page reads, with its range cap (detail pages inherit)', () => {
    expect(pageFiltersFor('/')).toEqual({
      app: true,
      range: true,
      environment: true,
      maxRangeMs: MAX_PERCENTILE_RANGE_MS,
    });
    expect(pageFiltersFor('/users/abc').maxRangeMs).toBe(MAX_COUNT_RANGE_MS);
    expect(pageFiltersFor('/live')).toMatchObject({ range: false, environment: false });
    expect(pageFiltersFor('/applications/ebo-sales')).toMatchObject({
      app: false,
      range: true,
      environment: true,
    });
    expect(pageFiltersFor('/apps')).toMatchObject({ app: false, range: false, environment: false });
    expect(pageFiltersFor('/integration')).toMatchObject({ environment: false });
    expect(pageFiltersFor('/geography').environment).toBe(true);
    expect(pageFiltersFor('/devices')).toEqual({
      app: true,
      range: true,
      environment: true,
      maxRangeMs: MAX_COUNT_RANGE_MS,
    });
    expect(pageFiltersFor('/geography').maxRangeMs).toBe(MAX_COUNT_RANGE_MS);
  });

  it('does not confuse /applications with /apps', () => {
    const apps = NAV_ITEMS.find((item) => item.id === 'apps')!;
    expect(isNavItemActive(apps, '/applications')).toBe(false);
  });
});
