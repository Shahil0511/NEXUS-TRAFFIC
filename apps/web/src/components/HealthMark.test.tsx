import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HealthMark } from './HealthMark';

describe('HealthMark', () => {
  it('shows the icon and a visible label as a badge', () => {
    const { container } = render(<HealthMark state="pass" label="Healthy" />);
    const label = screen.getByText('Healthy');
    expect(label).toBeVisible();
    expect(label).not.toHaveClass('sr-only');
    const icon = container.querySelector('svg')!;
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('text-success');
  });

  it('keeps the label for screen readers only as a dot', () => {
    const { container } = render(
      <HealthMark state="fail" label="Data health: Action needed" variant="dot" />,
    );
    expect(screen.getByText('Data health: Action needed')).toHaveClass('sr-only');
    expect(container.querySelector('svg')).toHaveClass('text-destructive');
  });

  it('styles the badge label only through labelClassName (icon alone on phones)', () => {
    render(<HealthMark state="pass" label="Healthy" labelClassName="max-sm:sr-only" />);
    expect(screen.getByText('Healthy')).toHaveClass('max-sm:sr-only');
  });

  it('colours a warning amber', () => {
    const { container } = render(<HealthMark state="warn" label="Needs attention" />);
    expect(container.querySelector('svg')).toHaveClass('text-warning');
  });
});
