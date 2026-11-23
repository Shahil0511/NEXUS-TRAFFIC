'use client';

import { useEffect } from 'react';

/** Surfaces that catch the light: every Card, plus anything opted in with `data-spotlight`. */
const LIT = '[data-slot="card"], [data-spotlight]';

/**
 * WHY: a soft purple light under the mouse on cards, the same touch as the Libas Leaderboard. One
 * passive pointer listener for the whole app, throttled to one write per frame: it finds the card
 * under the pointer, writes the pointer's position on that card as `--spot-x` / `--spot-y` and
 * marks it `data-spot`; the light itself is the card's `::after` in globals.css (a radial
 * gradient faded in with opacity), so only the lit card repaints. Fine pointers only (no touch),
 * and off under prefers-reduced-motion. Renders nothing.
 */
export function CursorSpotlight() {
  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lit: HTMLElement | null = null;
    let raf = 0;
    let last: { x: number; y: number; target: EventTarget | null } | null = null;

    const clear = () => {
      if (lit) delete lit.dataset.spot;
      lit = null;
    };
    const frame = () => {
      raf = 0;
      if (!last) return;
      const target = last.target instanceof Element ? last.target : null;
      const card = target?.closest<HTMLElement>(LIT) ?? null;
      if (card !== lit) clear();
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--spot-x', `${Math.round(last.x - rect.left)}px`);
      card.style.setProperty('--spot-y', `${Math.round(last.y - rect.top)}px`);
      if (lit !== card) {
        card.dataset.spot = '';
        lit = card;
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      last = { x: event.clientX, y: event.clientY, target: event.target };
      raf ||= requestAnimationFrame(frame);
    };
    const onLeave = () => {
      last = null;
      clear();
    };

    let on = false;
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
      raf = 0;
      onLeave();
    };
    const sync = () => {
      const want = fine.matches && !reduce.matches;
      if (want === on) return;
      on = want;
      if (on) {
        window.addEventListener('pointermove', onMove, { passive: true });
        document.documentElement.addEventListener('pointerleave', onLeave);
      } else {
        stop();
      }
    };
    sync();
    fine.addEventListener('change', sync);
    reduce.addEventListener('change', sync);
    return () => {
      fine.removeEventListener('change', sync);
      reduce.removeEventListener('change', sync);
      stop();
    };
  }, []);
  return null;
}
