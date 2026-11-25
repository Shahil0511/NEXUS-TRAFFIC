import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeadlineSentence } from './HeadlineSentence';

describe('HeadlineSentence', () => {
  it('renders one paragraph: plain words as text, numbers bold', () => {
    const { container } = render(
      <HeadlineSentence parts={['10 apps registered. ', { text: '9 of 10' }, ' sent data.']} />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent('10 apps registered. 9 of 10 sent data.');
    expect(screen.getByText('9 of 10').tagName).toBe('STRONG');
  });

  it('links a number to its page', () => {
    render(<HeadlineSentence parts={[{ text: '9 of 10', href: '/integration' }, ' sent data.']} />);
    const link = screen.getByRole('link', { name: '9 of 10' });
    expect(link).toHaveAttribute('href', '/integration');
    expect(link).toHaveClass('text-link');
  });

  it('colours a number by its status only when it has a tone', () => {
    render(
      <HeadlineSentence
        parts={[
          { text: '2 apps', href: '/errors', tone: 'destructive' },
          ' and ',
          { text: '3 apps', tone: 'warning' },
          ' and ',
          { text: '4 apps' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: '2 apps' }).closest('strong')).toHaveClass(
      'text-destructive',
    );
    const toned = screen.getByRole('link', { name: '2 apps' });
    expect(toned).not.toHaveClass('text-link');
    // Red stays red on hover and focus too: no class turns it violet; the underline marks the link.
    expect(toned.className).not.toMatch(/(hover|focus-visible):text-link/);
    expect(toned).toHaveClass('underline', 'focus-visible:ring-2');
    expect(screen.getByText('3 apps')).toHaveClass('text-warning');
    expect(screen.getByText('4 apps').className).not.toMatch(/text-(destructive|warning|success)/);
  });

  it('explains a number with an info tip beside it, outside the link', () => {
    render(
      <HeadlineSentence
        parts={[
          {
            text: '9K',
            href: '/endpoints',
            info: { label: 'API calls', text: 'How many API calls.' },
          },
        ]}
      />,
    );
    const tip = screen.getByRole('button', { name: 'What is API calls?' });
    expect(tip.closest('a')).toBeNull();
  });
});
