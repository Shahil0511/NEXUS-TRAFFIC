import { render, screen } from '@testing-library/react';
import { Eye } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { EmptyBoxIllustration } from './illustrations';
import { StateArt } from './StateArt';

const stateArt = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="state-art"]')!;

describe('StateArt', () => {
  it('is decorative: one aria-hidden wrapper holding one illustration and the badge icon', () => {
    const { container } = render(<StateArt art={EmptyBoxIllustration} icon={Eye} />);
    const art = stateArt(container);
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art.querySelectorAll('[data-illustration]')).toHaveLength(1);
    // The badge's lucide icon sits inside the hidden wrapper, so it never joins a name.
    expect(art.querySelectorAll('svg').length).toBe(2);
  });

  it('sizes the scene by `size`: w-24 inside panels, w-36 on full-page states', () => {
    const small = render(<StateArt art={EmptyBoxIllustration} icon={Eye} />);
    expect(stateArt(small.container).querySelector('[data-illustration]')).toHaveClass('w-24');
    small.unmount();
    const large = render(<StateArt art={EmptyBoxIllustration} icon={Eye} size="md" />);
    expect(stateArt(large.container).querySelector('[data-illustration]')).toHaveClass('w-36');
  });

  it('gives the alert badge an opaque card fill and the calm badge the accent', () => {
    const alert = render(<StateArt art={EmptyBoxIllustration} icon={Eye} tone="alert" />);
    const alertBadge = stateArt(alert.container).lastElementChild!;
    expect(alertBadge).toHaveClass('bg-card', 'text-destructive');
    alert.unmount();
    const calm = render(<StateArt art={EmptyBoxIllustration} icon={Eye} />);
    expect(stateArt(calm.container).lastElementChild).toHaveClass('bg-accent');
  });
});

describe('EmptyState', () => {
  it('is a status whose text is only the title and description (the art is hidden)', () => {
    const { container } = render(
      <EmptyState title="No tool usage" description="Tools appear once tagged." />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^No tool usageTools appear once tagged\.$/);
    expect(stateArt(container)).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ErrorState', () => {
  it('is an alert with the title and message, its art hidden from assistive tech', () => {
    const { container } = renderWithProviders(
      <ErrorState error={new Error('The network went away.')} title="Could not load the log" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the log');
    expect(alert).toHaveTextContent('The network went away.');
    const art = stateArt(container);
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(art.lastElementChild).toHaveClass('bg-card');
  });
});
