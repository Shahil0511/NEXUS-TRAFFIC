import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadMoreButton } from '@/components/LoadMoreButton';
import { PageEnd, pageEndLabel } from '@/components/PageEnd';
import { PageEndProvider } from '@/components/PageEndProvider';
import { PAGES } from '@/lib/pages';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({ usePathname: () => PAGES.errors() }));

const footer = () => screen.getByRole('contentinfo', { name: 'End of page' });

/** A query that never answers: the page stays on its first load. */
function PendingQuery() {
  useQuery({ queryKey: ['test', 'pending'], queryFn: () => new Promise<never>(() => undefined) });
  return null;
}

describe('PageEnd', () => {
  it('says the page is over only when nothing is loading and no list has more rows', () => {
    renderWithProviders(
      <PageEndProvider>
        <PageEnd />
      </PageEndProvider>,
    );
    expect(footer()).toHaveAttribute('data-status', 'end');
    expect(footer()).toHaveTextContent(/End of Problems/i);
  });

  it('says "still loading" while a query of the page is on its first load', async () => {
    renderWithProviders(
      <PageEndProvider>
        <PendingQuery />
        <PageEnd />
      </PageEndProvider>,
    );
    expect(await screen.findByText('Still loading…')).toBeInTheDocument();
    expect(footer()).not.toHaveTextContent(/End of/i);
  });

  it('points to "Load more" while a list above can load more rows', () => {
    renderWithProviders(
      <PageEndProvider>
        <LoadMoreButton hasMore loading={false} onLoadMore={() => undefined} shown={50} />
        <PageEnd />
      </PageEndProvider>,
    );
    expect(footer()).toHaveAttribute('data-status', 'more');
    expect(pageEndLabel('more', 'Errors')).toMatch(/Load more/);
  });
});
