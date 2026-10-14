import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { applicationCrumbs, Breadcrumbs } from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders a labelled nav with an ordered trail and marks the last step as the current page', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Users', href: '/users?range=7d' },
          { label: 's***@libas.in', href: '/ignored-for-the-current-page' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(nav).getByRole('list').tagName).toBe('OL');
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/users?range=7d',
    );
    // The current page is text, not a link to itself.
    const current = within(nav).getByText('s***@libas.in');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 's***@libas.in' })).toBeNull();
  });

  it('starts app-scoped trails at Applications › <app>, without the app filter in the hrefs', () => {
    const crumbs = applicationCrumbs('ebo-sales', { app: 'ebo-sales', range: '7d' });
    expect(crumbs).toEqual([
      { label: 'Applications', href: '/applications?range=7d' },
      { label: 'ebo-sales', href: '/applications/ebo-sales?range=7d' },
    ]);
  });

  it('drops whatever app the deep link carried, so the head never points at another app', () => {
    const crumbs = applicationCrumbs('ebo-sales', { app: 'other', range: '7d' });
    expect(crumbs.map((crumb) => crumb.href)).toEqual([
      '/applications?range=7d',
      '/applications/ebo-sales?range=7d',
    ]);
  });
});
