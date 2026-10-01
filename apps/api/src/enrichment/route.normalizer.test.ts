import { INGEST_LIMITS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { RouteNormalizer } from './route.normalizer';

describe('RouteNormalizer', () => {
  const normalizer = new RouteNormalizer();

  describe('derived from the path', () => {
    it.each([
      ['/ebo-sales/api/stores', '/ebo-sales/api/stores'],
      ['/api/stores/3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b', '/api/stores/:id'],
      ['/api/stores/3F2B8C1E-4A5D-4E6F-8A9B-0C1D2E3F4A5B/items', '/api/stores/:id/items'],
      ['/api/orders/1234567', '/api/orders/:num'],
      ['/api/orders/order-1234567', '/api/orders/order-:num'],
      ['/api/page/12345', '/api/page/12345'],
      ['/api/v1/items/2', '/api/v1/items/2'],
      ['/api/users/saurabh@libas.in', '/api/users/:email'],
      ['/api/users/saurabh%40libas.in/roles', '/api/users/:email/roles'],
      ['/api/files/d41d8cd98f00b204e9800998ecf8427e', '/api/files/:token'],
      ['/api/reset/aB3dEf9hIjK2mNoP', '/api/reset/:token'],
      ['/api/reset/k3j4h5g6f7d8s9a0q1w2', '/api/reset/:token'],
      ['/api/share/Xy7_-Ab3_cD9eF1gH', '/api/share/:token'],
      ['/api/reports/monthly-report-2024', '/api/reports/monthly-report-2024'],
      ['/api/reports/abcdefghijklmnopqrst', '/api/reports/abcdefghijklmnopqrst'],
      ['/api/short/abc123', '/api/short/abc123'],
      ['/', '/'],
      ['', '/'],
      ['/api//double', '/api//double'],
    ])('%s → %s', (path, expected) => {
      expect(normalizer.normalize(path)).toBe(expected);
    });
  });

  describe('supplied template', () => {
    it('is preferred over the path', () => {
      expect(normalizer.normalize('/api/stores/42', '/api/stores/:storeId')).toBe('/api/stores/:storeId');
    });

    it('is scrubbed too', () => {
      expect(normalizer.normalize('/x', '/api/users/a@b.co/orders/12345678')).toBe('/api/users/:email/orders/:num');
    });

    it('is ignored unless it starts with "/"', () => {
      expect(normalizer.normalize('/api/stores', 'api/stores/:id')).toBe('/api/stores');
    });

    it('is ignored when empty', () => {
      expect(normalizer.normalize('/api/stores', '')).toBe('/api/stores');
    });
  });

  it('truncates to maxRouteTemplateLength', () => {
    const result = normalizer.normalize(`/${'seg/'.repeat(200)}`);
    expect(result).toHaveLength(INGEST_LIMITS.maxRouteTemplateLength);
    expect(result.startsWith('/')).toBe(true);
  });
});
