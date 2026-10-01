import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_KEY, TEST_URL, setupHarness, type Harness } from './test-harness';

const navigation = vi.hoisted(() => ({ pathname: '/audits' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

const { NexusTracker } = await import('./next');

let h: Harness;
beforeEach(() => {
  h = setupHarness();
});
afterEach(() => {
  h.teardown();
});

describe('<NexusTracker/> (Next App Router)', () => {
  it('prefixes usePathname() with basePath (Next excludes it)', () => {
    navigation.pathname = '/audits';
    const view = render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, basePath: '/my-app' }));
    navigation.pathname = '/';
    view.rerender(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY, basePath: '/my-app' }));
    h.flushByTimer();
    const views = h.events().filter((e) => e.type === 'page_view');
    expect(views.map((v) => v.path)).toEqual(['/my-app/audits', '/my-app']);
  });

  it('renders nothing and waits while usePathname() is null', () => {
    navigation.pathname = null;
    const view = render(createElement(NexusTracker, { url: TEST_URL, publishableKey: TEST_KEY }));
    h.flushByTimer();
    expect(view.container.innerHTML).toBe('');
    expect(h.beacon).not.toHaveBeenCalled();
  });
});
