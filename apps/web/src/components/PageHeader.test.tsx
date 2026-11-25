import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGES } from '@/lib/pages';

import { PageHeader } from './PageHeader';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const iconTile = (container: HTMLElement) => container.querySelector('[data-slot="page-icon"]');
const illustration = (container: HTMLElement) => container.querySelector('[data-illustration]');

describe('PageHeader', () => {
  beforeEach(() => {
    pathname.current = PAGES.users();
  });

  it("shows the section's nav icon in a decorative tile left of the title", () => {
    const { container } = render(<PageHeader title="People" />);
    const tile = iconTile(container)!;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.querySelector('svg')).not.toBeNull();
    // The tile comes before the title in reading order and does not change its name.
    const heading = screen.getByRole('heading', { level: 1, name: 'People' });
    expect(tile.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the section illustration from md up only, hidden from assistive tech', () => {
    const { container } = render(<PageHeader title="People" />);
    const art = illustration(container)!;
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art).toHaveClass('hidden', 'md:block');
  });

  it("gives a detail page its section's icon, but no art, and wraps its long title", () => {
    pathname.current = PAGES.userDetail('u:abc');
    const { container } = render(<PageHeader title="someone.with.a.long.name@libas.in" />);
    expect(iconTile(container)).not.toBeNull();
    // The art would take the width the identifier needs; its end tells two items apart.
    expect(illustration(container)).toBeNull();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).not.toHaveClass('truncate');
    expect(heading).toHaveClass('break-words');
  });

  it('renders a headline under the title, outside the description paragraph', () => {
    render(
      <PageHeader title="Apps" description="Last 7 days" headline={<p>10 apps registered.</p>} />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Apps' });
    const headline = screen.getByText('10 apps registered.');
    expect(
      heading.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(headline.parentElement?.closest('p')).toBeNull();
  });

  it('shows neither on a page outside the navigation', () => {
    pathname.current = '/somewhere-else';
    const { container } = render(<PageHeader title="Elsewhere" />);
    expect(iconTile(container)).toBeNull();
    expect(illustration(container)).toBeNull();
  });
});
