import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusCode, statusToneOf } from './StatusCode';

describe('statusToneOf', () => {
  it('gives each status class its own tone', () => {
    expect(statusToneOf(101)).toBe('info');
    expect(statusToneOf(200)).toBe('success');
    expect(statusToneOf(299)).toBe('success');
    expect(statusToneOf(304)).toBe('info');
    expect(statusToneOf(400)).toBe('client-error');
    expect(statusToneOf(499)).toBe('client-error');
    expect(statusToneOf(500)).toBe('server-error');
    expect(statusToneOf(503)).toBe('server-error');
  });
});

describe('StatusCode', () => {
  it.each([
    [204, 'success', 'text-success'],
    [302, 'info', 'text-info'],
    [404, 'client-error', 'text-warning'],
    [502, 'server-error', 'text-destructive'],
  ])('renders %i as a %s pill with its number as the label', (status, tone, textClass) => {
    render(<StatusCode status={status} />);
    const pill = screen.getByText(String(status));
    expect(pill).toHaveAttribute('data-tone', tone);
    expect(pill).toHaveClass(textClass, 'text-2xs');
  });
});
