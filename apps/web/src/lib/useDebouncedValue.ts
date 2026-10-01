'use client';

import { useEffect, useState } from 'react';

/**
 * WHY: a search box must not fire one API request per keystroke; the value settles first.
 * Returns `value` once it has stopped changing for `delayMs`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
