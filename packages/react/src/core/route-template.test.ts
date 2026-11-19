import { describe, expect, it } from 'vitest';

import { joinBasePath } from './paths';
import { nextRouteTemplate, toWireRouteTemplate } from './route-template';

describe('nextRouteTemplate', () => {
  it('replaces a scalar param with :name', () => {
    expect(nextRouteTemplate('/stores/delhi-saket', { id: 'delhi-saket' })).toBe('/stores/:id');
    expect(nextRouteTemplate('/stores/7/audits/42', { store: '7', audit: '42' })).toBe(
      '/stores/:store/audits/:audit',
    );
  });

  it('replaces a catch-all run with :name*', () => {
    expect(nextRouteTemplate('/docs/a/b/c', { slug: ['a', 'b', 'c'] })).toBe('/docs/:slug*');
  });

  it('an optional catch-all that is undefined leaves the path as is', () => {
    expect(nextRouteTemplate('/docs', { slug: undefined })).toBe('/docs');
  });

  it('a static route (no params) is its own template', () => {
    expect(nextRouteTemplate('/audits', {})).toBe('/audits');
    expect(nextRouteTemplate('/', {})).toBe('/');
  });

  it('a value that occurs twice → undefined (we cannot know which segment it is)', () => {
    expect(nextRouteTemplate('/compare/7/7', { a: '7' })).toBeUndefined();
    expect(nextRouteTemplate('/x/1/y/1', { a: '1', b: '1' })).toBeUndefined();
  });

  it('a value that is not in the path → undefined', () => {
    expect(nextRouteTemplate('/stores/1', { id: '2' })).toBeUndefined();
  });

  it('matches a percent-encoded segment against the decoded param', () => {
    expect(nextRouteTemplate('/users/a%20b', { id: 'a b' })).toBe('/users/:id');
    expect(nextRouteTemplate('/users/%E0%A4%85', { id: 'अ' })).toBe('/users/:id');
  });

  it('works with basePath through joinBasePath', () => {
    const template = nextRouteTemplate('/stores/1', { id: '1' })!;
    expect(joinBasePath('/my-app', template)).toBe('/my-app/stores/:id');
  });

  it('null params (outside the App Router) → undefined', () => {
    expect(nextRouteTemplate('/stores/1', null)).toBeUndefined();
  });

  it('a throwing params getter → undefined, never a throw', () => {
    const params = {};
    Object.defineProperty(params, 'id', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(() => nextRouteTemplate('/stores/1', params)).not.toThrow();
    expect(nextRouteTemplate('/stores/1', params)).toBeUndefined();
  });
});

describe('toWireRouteTemplate', () => {
  it('strips ?# and forces a leading slash', () => {
    expect(toWireRouteTemplate('stores/:id?x=1#y')).toBe('/stores/:id');
  });

  it('drops over-long and empty values', () => {
    expect(toWireRouteTemplate(`/${'a'.repeat(256)}`)).toBeUndefined();
    expect(toWireRouteTemplate(`/${'a'.repeat(255)}`)).toHaveLength(256);
    expect(toWireRouteTemplate('')).toBeUndefined();
    expect(toWireRouteTemplate(null)).toBeUndefined();
  });
});
