// @vitest-environment node
/**
 * Contrast guard of the colour tokens in globals.css (WCAG 2.x relative luminance).
 *
 * WHY: the AA floors documented at the top of globals.css are easy to break with a "nicer" hex;
 * this parses the real file so a palette edit that drops a text token under 4.5:1 (or a chart
 * mark under 3:1) fails CI instead of shipping.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

/** The `--name: #hex;` declarations of one selector block (`:root` or `.dark`). */
function tokensOf(selector: string): Record<string, string> {
  const start = css.indexOf(`
${selector} {`);
  if (start < 0) throw new Error(`globals.css has no top-level "${selector} {" block`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

function rgbOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `fg` laid over `bg` at `alpha` (a `bg-x/12` pill), as an opaque colour. */
function tintOf(fg: string, bg: string, alpha: number): [number, number, number] {
  const f = rgbOf(fg);
  const b = rgbOf(bg);
  return [0, 1, 2].map((i) => f[i]! * alpha + b[i]! * (1 - alpha)) as [number, number, number];
}

function contrastOf(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT_TOKENS = ['link', 'info', 'success', 'warning', 'destructive'];
const METHOD_TOKENS = ['method-get', 'method-post', 'method-put', 'method-patch', 'method-delete'];
const PILL_ALPHA: Record<string, number> = {
  info: 0.12,
  success: 0.12,
  warning: 0.12,
  destructive: 0.12,
};

describe.each([':root', '.dark'])('colour tokens of %s', (selector) => {
  const tokens = tokensOf(selector);
  const surfaces = [tokens.background!, tokens.card!];

  it.each([...TEXT_TOKENS, ...METHOD_TOKENS])(
    '--%s reaches 4.5:1 on background and card',
    (name) => {
      const fg = tokens[name]!;
      for (const surface of surfaces) {
        expect(contrastOf(rgbOf(fg), rgbOf(surface))).toBeGreaterThanOrEqual(4.5);
        const alpha = PILL_ALPHA[name] ?? (name.startsWith('method-') ? 0.1 : undefined);
        if (alpha !== undefined) {
          expect(contrastOf(rgbOf(fg), tintOf(fg, surface, alpha))).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(['chart-requests', 'chart-4xx', 'chart-5xx'])('--%s reaches 3:1 on the card', (name) => {
    expect(contrastOf(rgbOf(tokens[name]!), rgbOf(tokens.card!))).toBeGreaterThanOrEqual(3);
  });

  it('--link stays AA on the hover surfaces it sits on (AppChip accent, muted rows)', () => {
    for (const surface of [tokens.accent!, tokens.muted!]) {
      expect(contrastOf(rgbOf(tokens.link!), rgbOf(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the stacked 4xx/5xx chart marks apart in lightness (not hue alone)', () => {
    const step = contrastOf(rgbOf(tokens['chart-4xx']!), rgbOf(tokens['chart-5xx']!));
    expect(step).toBeGreaterThanOrEqual(1.2);
  });
});
