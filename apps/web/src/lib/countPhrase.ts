import { formatInteger } from './format';

/**
 * WHY: sentences on screen say "1 visit" and "140 visits", never "1 visits". One helper so every
 * headline builder and count line gets the singular right. Pure. 1234 → "1,234 times".
 */
export function countPhrase(count: number, one: string, many: string): string {
  return `${formatInteger(count)} ${count === 1 ? one : many}`;
}

/** WHY: "verified person" / "verified people" is the one phrase for counted people (ADR 0019). */
export function verifiedPeople(count: number): string {
  return countPhrase(count, 'verified person', 'verified people');
}
