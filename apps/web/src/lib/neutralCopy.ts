/**
 * The words the person pages must never show, and the helpers the copy tests use to find them.
 *
 * WHY: the owner's call (decision 2c, ADR 0017) is that per-person, per-day facts are shown as
 * plain facts: when activity started and ended, how long a page was on screen, which apps. Words
 * that turn those facts into a judgement of the person (a score, a rank, attendance, hours worked)
 * or into a description of watching them are banned from rendered text, aria-labels, titles, alt
 * text and placeholders. The rendered-text test (`personCopy.test.tsx`) and the metric copy test
 * scan for them, so a new label cannot slip one in. USED ONLY BY TESTS: screens never import it.
 *
 * @see ../../../../ai-context/decisions/0017-person-daily-depth.md
 */

/**
 * Whole words only (`\b`), case-insensitive, so code-ish neighbours such as "Frankfurt" or
 * "underscore" never match. NEVER shorten the list to make a screen pass: change the screen.
 * No `g` flag, so `.test()` keeps no `lastIndex` between calls; `findBannedWords` builds its own
 * global copy.
 */
export const NEUTRAL_COPY_BANNED =
  /\b(?:productivity|productive|performance|performer|scores?|scored|scoring|rank|ranks|ranking|rankings|ranked|leaderboards?|attendance|hours worked|absent|absence|absences|employees?|staff|monitor|monitors|monitored|monitoring|surveillance|top performers?|bottom performers?)\b/i;

/** Every banned word in `text`, lower-cased, in order of appearance (repeats kept). Pure. */
export function findBannedWords(text: string): string[] {
  const everyMatch = new RegExp(NEUTRAL_COPY_BANNED.source, 'gi');
  return Array.from(text.matchAll(everyMatch), (match) => match[0].toLowerCase());
}

/** The attributes a reader meets besides the text itself (screen reader, tooltip, image, input). */
const READ_ATTRIBUTES = ['aria-label', 'title', 'alt', 'placeholder'] as const;

/**
 * All text a reader can meet under `root`: its textContent plus the value of every aria-label,
 * title, alt and placeholder attribute, one per line. Class names and ids are NOT included, so
 * a component or icon named after a banned word (e.g. an icon class) gives no false hit.
 */
export function collectRenderedText(root: Element): string {
  const parts = [root.textContent ?? ''];
  const selector = READ_ATTRIBUTES.map((name) => `[${name}]`).join(',');
  const elements = [root, ...Array.from(root.querySelectorAll(selector))];
  for (const element of elements) {
    for (const name of READ_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) parts.push(value);
    }
  }
  return parts.join('\n');
}
