import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NAV_ITEMS, NAV_SECTIONS } from '@/lib/nav';
import { PAGES } from '@/lib/pages';
import { renderWithProviders } from '@/test/render';

import { DashboardNav, MobileNav } from './MobileNav';

vi.mock('next/navigation', () => ({ usePathname: () => PAGES.errors() }));

describe('MobileNav', () => {
  it('opens a labelled sheet listing every nav item, carrying the filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MobileNav />, { searchParams: '?range=7d&app=ebo-sales' });

    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);

    const sheet = await screen.findByRole('dialog', { name: 'Data Nexus Traffic' });
    const nav = within(sheet).getByRole('navigation', { name: 'Dashboard' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${item.label}`) })).toBeVisible();
    }
    const errors = within(nav).getByRole('link', { name: /^Errors/ });
    expect(errors).toHaveAttribute('aria-current', 'page');
    expect(errors).toHaveAttribute('href', `${PAGES.errors()}?app=ebo-sales&range=7d`);
  });

  it('closes on Escape and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MobileNav />);

    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes when a link is followed', async () => {
    // jsdom cannot navigate; cancel the click's default after React (and the link) handled it.
    const cancel = (event: Event) => event.preventDefault();
    document.addEventListener('click', cancel);
    try {
      const user = userEvent.setup();
      renderWithProviders(<MobileNav />);

      await user.click(screen.getByRole('button', { name: 'Open navigation' }));
      const sheet = await screen.findByRole('dialog');
      await user.click(within(sheet).getByRole('link', { name: /^Users/ }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    } finally {
      document.removeEventListener('click', cancel);
    }
  });

  it('draws section labels in full muted-foreground (no opacity: 4.5:1 on the sidebar)', () => {
    renderWithProviders(<DashboardNav variant="full" />);
    for (const section of NAV_SECTIONS) {
      const label = screen.getByText(section.label, { selector: 'p' });
      expect(label).toHaveClass('text-muted-foreground');
      expect(label.className).not.toMatch(/text-muted-foreground\//);
    }
  });
});
