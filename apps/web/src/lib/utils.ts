import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** WHY: merge conditional class lists and let later Tailwind utilities win (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
