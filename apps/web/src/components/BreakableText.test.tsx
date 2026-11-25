import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BreakableText } from './BreakableText';

function renderIn(text: string) {
  const { container } = render(
    <span>
      <BreakableText text={text} />
    </span>,
  );
  return container.firstElementChild as HTMLElement;
}

describe('BreakableText', () => {
  it('allows a break only after path slashes, never mid-word', () => {
    const span = renderIn('/leaderboard/regions');
    expect(span.textContent).toBe('/leaderboard/regions');
    expect(span.innerHTML).toBe('/<wbr>leaderboard/<wbr>regions');
  });

  it('allows a break after the dots, dashes and underscores of a feature name', () => {
    const span = renderIn('filters.date.financial-year_v2');
    expect(span.textContent).toBe('filters.date.financial-year_v2');
    expect(span.querySelectorAll('wbr')).toHaveLength(4);
  });

  it('adds nothing to text without separators', () => {
    const span = renderIn('dashboard');
    expect(span.innerHTML).toBe('dashboard');
  });
});
