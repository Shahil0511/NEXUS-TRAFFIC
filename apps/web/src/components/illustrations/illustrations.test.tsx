import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NAV_ITEMS } from '@/lib/nav';

import { NAV_ILLUSTRATIONS, STATE_ILLUSTRATIONS } from './index';

const ALL_ART = [...Object.entries(NAV_ILLUSTRATIONS), ...Object.entries(STATE_ILLUSTRATIONS)];

/**
 * The colour utilities the art may use: theme tokens only (optionally with an /alpha). WHY an
 * allowlist on the CLASS: every colour is set through className, so `fill-white`, `fill-[#71006a]`
 * or `stroke-black` would ignore the theme and must fail here.
 */
const TOKEN_COLOUR_CLASS =
  /^(fill|stroke)-(none|card|accent|border|primary|primary-foreground|success|destructive|chart-[a-z0-9-]+|method-[a-z]+)(\/\d+)?$/;

/** The fill-* / stroke-* utilities of one element, variants (dark:, hover:) stripped. */
function colourClasses(element: Element): string[] {
  return (element.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((token) => token !== '' && !token.startsWith('['))
    .map((token) => token.split(':').at(-1)!)
    .filter((utility) => /^(fill|stroke)-/.test(utility) && !/^stroke-\d/.test(utility));
}

describe('illustrations', () => {
  it('has a hero motif for every nav item, and nothing for ids the nav does not have', () => {
    const navIds = NAV_ITEMS.map((item) => item.id).sort();
    expect(Object.keys(NAV_ILLUSTRATIONS).sort()).toEqual(navIds);
    for (const id of navIds) expect(NAV_ILLUSTRATIONS[id]).toBeTypeOf('function');
  });

  it('lists every state scene, and every one is a component', () => {
    expect(Object.keys(STATE_ILLUSTRATIONS).length).toBeGreaterThanOrEqual(4);
    for (const Art of Object.values(STATE_ILLUSTRATIONS)) expect(Art).toBeTypeOf('function');
  });

  it.each(ALL_ART)('%s is decorative: aria-hidden, not focusable, no text', (_name, Art) => {
    const { container } = render(<Art className="w-40" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('data-illustration');
    expect(svg).toHaveClass('w-40');
    expect(svg.querySelector('text')).toBeNull();
    expect(svg.textContent).toBe('');
  });

  it.each(ALL_ART)(
    '%s draws only with token colour utilities (no raw colours), so both themes work',
    (_name, Art) => {
      const { container } = render(<Art />);
      const elements = [container.querySelector('svg')!, ...container.querySelectorAll('svg *')];
      for (const element of elements) {
        for (const utility of colourClasses(element)) {
          expect(utility, element.outerHTML).toMatch(TOKEN_COLOUR_CLASS);
        }
        for (const attribute of ['fill', 'stroke']) {
          const value = element.getAttribute(attribute);
          if (value !== null) expect(value).toMatch(/^(none|currentColor)$/);
        }
        expect(element.getAttribute('style')).toBeNull();
        expect(element.getAttribute('stop-color')).toBeNull();
      }
    },
  );

  it('rejects raw colour utilities (the allowlist really bites)', () => {
    for (const raw of ['fill-white', 'stroke-black', 'fill-[#71006a]', 'fill-[rgb(1,2,3)]']) {
      expect(raw).not.toMatch(TOKEN_COLOUR_CLASS);
    }
    expect('fill-primary/25').toMatch(TOKEN_COLOUR_CLASS);
  });
});
