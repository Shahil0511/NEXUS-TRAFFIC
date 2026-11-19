import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_KEY, TEST_URL, setupHarness, type Harness } from './test-harness';

const navigation = vi.hoisted(() => ({
  pathname: '/audits' as string | null,
  params: {} as Record<string, string | string[] | undefined> | null,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useParams: () => navigation.params,
}));

const { NexusTracker } = await import('./next');

let h: Harness;
beforeEach(() => {
  h = setupHarness();
  navigation.params = {};
});
afterEach(() => {
  h.teardown();
});

describe('<NexusTracker/> (Next App Router)', () => {
  it('prefixes usePathname() with basePath (Next excludes it)', async () => {
    navigation.pathname = '/audits';
    const view = render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, basePath: '/my-app' }));
    navigation.pathname = '/';
    view.rerender(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, basePath: '/my-app' }));
    await h.flushByTimer();
    const views = h.events().filter((e) => e.type === 'page_view');
    expect(views.map((v) => v.path)).toEqual(['/my-app/audits', '/my-app']);
  });

  it('renders nothing and waits while usePathname() is null', async () => {
    navigation.pathname = null;
    const view = render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY }));
    await h.flushByTimer();
    expect(view.container.innerHTML).toBe('');
    expect(h.sent()).toEqual([]);
  });

  it('derives the route template from useParams(), basePath included', async () => {
    navigation.pathname = '/stores/delhi-saket/audits/42';
    navigation.params = { store: 'delhi-saket', id: '42' };
    render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, basePath: '/my-app' }));
    await h.flushByTimer();
    expect(h.events()[0]).toMatchObject({
      path: '/my-app/stores/delhi-saket/audits/42',
      routeTemplate: '/my-app/stores/:store/audits/:id',
    });
  });

  it('a routeTemplate prop overrides the derived one', async () => {
    navigation.pathname = '/stores/1';
    navigation.params = { id: '1' };
    render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, routeTemplate: '/custom/:x' }));
    await h.flushByTimer();
    expect(h.events()[0]!.routeTemplate).toBe('/custom/:x');
  });

  it('useParams() returning null → no template, still a page view', async () => {
    navigation.pathname = '/stores/1';
    navigation.params = null;
    render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY }));
    await h.flushByTimer();
    const [event] = h.events();
    expect(event).toMatchObject({ type: 'page_view', path: '/stores/1' });
    expect(event!.routeTemplate).toBeUndefined();
  });

  it('a params object whose getter throws → no template, and the host still renders', async () => {
    navigation.pathname = '/stores/1';
    const params = {};
    Object.defineProperty(params, 'id', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    navigation.params = params;
    const host = createElement('main', null, 'host', createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY }));
    const view = render(host);
    await h.flushByTimer();
    expect(view.container.textContent).toBe('host');
    const [event] = h.events();
    expect(event).toMatchObject({ type: 'page_view', path: '/stores/1' });
    expect(event!.routeTemplate).toBeUndefined();
  });
});
