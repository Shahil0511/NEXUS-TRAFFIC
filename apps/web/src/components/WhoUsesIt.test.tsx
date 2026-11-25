import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { USER_KEY } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';

import { WHO_ADMINS_ONLY } from './AdminsOnlyNote';
import { WhoUsesIt } from './WhoUsesIt';

const USERS = [
  { userKey: USER_KEY, email: 'buyer@libas.in', count: 40, lastSeenAt: '2026-10-01T07:00:00.000Z' },
];

describe('WhoUsesIt', () => {
  it('shows an admin the count and the people, most first', async () => {
    renderWithProviders(
      <WhoUsesIt
        count={9}
        users={USERS}
        unit="views"
        ariaLabel="Who views this page"
        linkQuery={{}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Who uses it' })).toBeInTheDocument();
    expect(screen.getByText('9 verified people')).toBeInTheDocument();
    expect(screen.getByText('Most views first')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Who views this page' });
    expect(await within(list).findByRole('link', { name: 'buyer@libas.in' })).toBeInTheDocument();
    expect(screen.queryByText(WHO_ADMINS_ONLY)).not.toBeInTheDocument();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });

  it('shows everyone else the count and the note, no list (users null)', () => {
    renderWithProviders(
      <WhoUsesIt
        count={9}
        users={null}
        unit="views"
        ariaLabel="Who views this page"
        linkQuery={{}}
      />,
    );
    expect(screen.getByText('9 verified people')).toBeInTheDocument();
    expect(screen.getByText(WHO_ADMINS_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/most views first/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('@');
  });

  it("shows the list's empty state for an admin when nobody is verified", () => {
    renderWithProviders(
      <WhoUsesIt
        count={0}
        users={[]}
        unit="calls"
        ariaLabel="Who calls it"
        linkQuery={{}}
        emptyTitle="No verified caller"
        title="Who calls it"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Who calls it' })).toBeInTheDocument();
    expect(screen.getByText('0 verified people')).toBeInTheDocument();
    expect(screen.getByText('No verified caller')).toBeInTheDocument();
    expect(screen.queryByText(WHO_ADMINS_ONLY)).not.toBeInTheDocument();
  });

  it('says "person" for one', () => {
    renderWithProviders(
      <WhoUsesIt
        count={1}
        users={null}
        unit="uses"
        ariaLabel="Who uses this feature"
        linkQuery={{}}
      />,
    );
    expect(screen.getByText('1 verified person')).toBeInTheDocument();
  });
});
