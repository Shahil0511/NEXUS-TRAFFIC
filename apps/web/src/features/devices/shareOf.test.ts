import { SERVER_BREAKDOWN_DIMENSION_VALUES } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { BREAKDOWN } from '@/test/fixtures';

import {
  breakdownRows,
  DEVICE_DIMENSIONS,
  isDimensionAvailable,
  PLACE_DIMENSIONS,
  PLACES_GEO_METRICS,
  SHARE_OF_COPY,
  SHARE_OF_VALUES,
  shareOfGeoMetric,
  UNIT_OF_SOURCE,
} from './shareOf';

describe('isDimensionAvailable', () => {
  it('offers every page dimension for page views', () => {
    for (const dimension of [...DEVICE_DIMENSIONS, ...PLACE_DIMENSIONS]) {
      expect(isDimensionAvailable(dimension, 'pageViews'), dimension).toBe(true);
    }
  });

  it('greys out what server requests lack (time zone, language) and keeps the rest', () => {
    for (const dimension of DEVICE_DIMENSIONS) {
      expect(SERVER_BREAKDOWN_DIMENSION_VALUES).toContain(dimension);
      expect(isDimensionAvailable(dimension, 'requests'), dimension).toBe(true);
    }
    expect(isDimensionAvailable('client_tz', 'requests')).toBe(false);
    expect(isDimensionAvailable('client_lang', 'requests')).toBe(false);
  });
});

describe('share-of copy', () => {
  it('maps each choice to a source with a plural unit and a country metric', () => {
    expect(SHARE_OF_COPY.pageViews.source).toBe('browser');
    expect(SHARE_OF_COPY.requests.source).toBe('server');
    expect(UNIT_OF_SOURCE.browser).toBe('page views');
    expect(UNIT_OF_SOURCE.server).toBe('API calls');
    for (const share of SHARE_OF_VALUES) {
      expect(shareOfGeoMetric(SHARE_OF_COPY[share].geoMetric)).toBe(share);
    }
    expect(shareOfGeoMetric('users')).toBeNull();
    expect(PLACES_GEO_METRICS).toEqual(['pageViews', 'requests']);
  });
});

describe('breakdownRows', () => {
  it('names values, marks "Not sent" muted and keys null apart from real values', () => {
    const rows = breakdownRows(BREAKDOWN);
    expect(rows.map((row) => row.label)).toEqual(['Chrome', 'Safari', 'Not sent']);
    expect(rows.map((row) => row.key)).toEqual(['v:Chrome', 'v:Safari', '']);
    expect(rows[2]).toMatchObject({ muted: true, count: 10, share: 0.01 });
    expect(rows[0]?.muted).toBe(false);
  });
});
