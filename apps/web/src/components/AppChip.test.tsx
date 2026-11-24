import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppChipList } from './AppChip';

describe('AppChipList', () => {
  it('shows up to max chips, then +N whose hidden names reach screen readers too', () => {
    render(<AppChipList apps={['app-a', 'app-b', 'app-c', 'app-d']} max={2} />);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['app-a', 'app-b']);
    const more = screen.getByText(/more: app-c, app-d/);
    expect(more).toHaveClass('sr-only');
    expect(more.parentElement).toHaveTextContent('+2 more: app-c, app-d');
  });

  it('adds no count when every app fits', () => {
    render(<AppChipList apps={['app-a']} max={3} />);
    expect(screen.queryByText(/more:/)).toBeNull();
  });
});
