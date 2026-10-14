import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { Panel } from './Panel';

describe('Panel', () => {
  it('labels each region by its own heading, even when two panels share a title', () => {
    render(
      <>
        <Panel title="Countries">first</Panel>
        <Panel title="Countries">second</Panel>
      </>,
    );
    const headings = screen.getAllByText('Countries');
    const ids = headings.map((heading) => heading.id);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(2);
    for (const heading of headings) {
      expect(document.querySelectorAll(`[aria-labelledby="${heading.id}"]`)).toHaveLength(1);
    }
  });

  it('lets the header wrap and the aside shrink (no shrink-0 overflow on a phone)', () => {
    const { container } = render(
      <Panel title="Failed requests" aside={<button type="button">4xx</button>}>
        body
      </Panel>,
    );
    const header = container.querySelector('[data-slot="card-header"]')!;
    const aside = container.querySelector('[data-slot="panel-aside"]')!;
    expect(header).toHaveClass('flex-wrap');
    expect(aside).toHaveClass('min-w-0', 'max-w-full');
    expect(aside).not.toHaveClass('shrink-0');
    // Title first, aside after it: on a shared line the aside stays on the right.
    expect(header.firstElementChild).toHaveAttribute('data-slot', 'panel-title');
    expect(header.lastElementChild).toBe(aside);
  });

  it('makes the heading a programmatic focus target only when asked to', () => {
    const headingRef = createRef<HTMLHeadingElement>();
    render(
      <>
        <Panel title="Plain">a</Panel>
        <Panel title="Focusable" headingRef={headingRef}>
          b
        </Panel>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Plain' })).not.toHaveAttribute('tabindex');
    const focusable = screen.getByRole('heading', { name: 'Focusable' });
    expect(headingRef.current).toBe(focusable);
    expect(focusable).toHaveAttribute('tabindex', '-1');
    headingRef.current!.focus();
    expect(focusable).toHaveFocus();
  });
});
