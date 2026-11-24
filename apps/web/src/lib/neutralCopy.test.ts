import { describe, expect, it } from 'vitest';

import { collectRenderedText, findBannedWords } from './neutralCopy';

describe('findBannedWords', () => {
  it('finds every banned word, whole words only and in any case', () => {
    expect(
      findBannedWords(
        'Productivity score, Ranked list, Leaderboard, attendance, Hours worked, absent staff',
      ),
    ).toEqual([
      'productivity',
      'score',
      'ranked',
      'leaderboard',
      'attendance',
      'hours worked',
      'absent',
      'staff',
    ]);
    expect(findBannedWords('Employee monitoring and surveillance; top performer')).toEqual([
      'employee',
      'monitoring',
      'surveillance',
      'top performer',
    ]);
  });

  it('leaves neutral labels and look-alike words alone', () => {
    const neutral = [
      'Time in app',
      'Tab visible time',
      'First activity',
      'Last activity',
      'Active days',
      'Usual activity hours',
      'Visit steps',
      'Visits',
      'Apps',
      'Page views',
      'Feature uses',
      'API calls',
      'Frankfurt',
      'underscore',
      'Top pages',
    ].join(' · ');
    expect(findBannedWords(neutral)).toEqual([]);
  });

  it('gives the same answer when called twice (no regex state carried over)', () => {
    expect(findBannedWords('score')).toEqual(['score']);
    expect(findBannedWords('score')).toEqual(['score']);
  });
});

describe('collectRenderedText', () => {
  it('reads the text and every aria-label, title, alt and placeholder, but not class names', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<p>Visible text</p>',
      '<button aria-label="Screen reader name"></button>',
      '<span title="Tooltip text"></span>',
      '<img alt="Image text" />',
      '<input placeholder="Input hint" />',
      '<svg class="lucide-monitor-smartphone"></svg>',
    ].join('');
    const text = collectRenderedText(root);
    for (const part of [
      'Visible text',
      'Screen reader name',
      'Tooltip text',
      'Image text',
      'Input hint',
    ]) {
      expect(text).toContain(part);
    }
    expect(findBannedWords(text)).toEqual([]);
  });

  it('includes the attributes of the root itself', () => {
    const root = document.createElement('section');
    root.setAttribute('aria-label', 'Staff list');
    expect(findBannedWords(collectRenderedText(root))).toEqual(['staff']);
  });
});
