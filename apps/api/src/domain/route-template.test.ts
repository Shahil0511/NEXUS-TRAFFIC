import { describe, expect, it } from 'vitest';

import { isPlausibleRouteTemplate } from './route-template';

const BASE = '/ebo-sales';

describe('isPlausibleRouteTemplate', () => {
  it.each([
    ['/ebo-sales/orders/:id', '/ebo-sales/orders/42'],
    ['/ebo-sales/orders/:id/items/:item', '/ebo-sales/orders/42/items/7'],
    ['/ebo-sales/Orders/:id', '/ebo-sales/orders/42'],
    ['/ebo-sales/docs/:slug*', '/ebo-sales/docs/a/b/c'],
    ['/ebo-sales/docs/:slug*', '/ebo-sales/docs'],
    ['/ebo-sales/stores', '/ebo-sales/stores/'],
    ['/ebo-sales/caf%C3%A9/:id', '/ebo-sales/caf%C3%A9/1'],
    ['/ebo-sales/café/:id', '/ebo-sales/caf%C3%A9/1'],
  ])('keeps %s for %s', (template, path) => {
    expect(isPlausibleRouteTemplate(template, path, BASE)).toBe(true);
  });

  it.each([
    // outside the base path
    ['/other/orders/:id', '/ebo-sales/orders/42'],
    // segment count differs
    ['/ebo-sales/orders/:id', '/ebo-sales/orders/42/items'],
    ['/ebo-sales/orders/:id/items', '/ebo-sales/orders/42'],
    // a static segment differs (template of another page)
    ['/ebo-sales/customers/:id', '/ebo-sales/orders/42'],
    // catch-all needs the fixed prefix
    ['/ebo-sales/docs/x/:slug*', '/ebo-sales/docs'],
    ['/ebo-sales/blog/:slug*', '/ebo-sales/docs/a'],
  ])('drops %s for %s', (template, path) => {
    expect(isPlausibleRouteTemplate(template, path, BASE)).toBe(false);
  });

  it('a null base path owns the whole origin', () => {
    expect(isPlausibleRouteTemplate('/orders/:id', '/orders/1', null)).toBe(true);
  });
});
