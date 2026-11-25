import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { collectRenderedText, findBannedWords } from '@/lib/neutralCopy';
import { PAGES } from '@/lib/pages';
import { appHealth, HEALTH_TO } from '@/test/adminFixtures';
import { renderWithProviders } from '@/test/render';

import { AppHealthCard } from './AppHealthCard';

describe('AppHealthCard', () => {
  it('heads the card with the name, slug copy, View traffic and badges over every block', () => {
    renderWithProviders(
      <AppHealthCard health={appHealth()} nowMs={new Date(HEALTH_TO).getTime()} />,
    );

    const card = screen.getByRole('region', { name: 'EBO Sales' });
    expect(within(card).getByRole('heading', { level: 2, name: 'EBO Sales' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Copy app slug' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /View traffic/ })).toHaveAttribute(
      'href',
      PAGES.applicationDetail('ebo-sales'),
    );
    expect(within(card).getAllByText('Connected').length).toBeGreaterThan(0);
    expect(within(card).getByText('Healthy')).toBeInTheDocument();

    // The details sit under the card title: their blocks are h3s.
    expect(within(card).getByRole('list', { name: 'Warnings for EBO Sales' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { level: 3, name: 'Coverage' })).toBeInTheDocument();
    expect(within(card).queryByRole('heading', { level: 4 })).toBeNull();
    expect(findBannedWords(collectRenderedText(document.body))).toEqual([]);
  });
});
