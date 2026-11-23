/**
 * Pure helpers of the person page's identity card and Devices tab: a neutral initials tile, and
 * the label + icon of a device type (`ua_device`: desktop | mobile | tablet | bot | other).
 */
import { Bot, CircleHelp, Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react';

/** What the card prints for a fact that was not sent or could not be read. */
export const UNKNOWN_FACT = 'Unknown';

const DEVICE_ICONS: Record<string, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  bot: Bot,
};

/** "desktop" → "Desktop"; null → "Unknown". */
export function deviceLabel(device: string | null): string {
  if (!device) return UNKNOWN_FACT;
  return device.charAt(0).toUpperCase() + device.slice(1);
}

/** The small icon next to a device type (a question mark when unknown or "other"). */
export function deviceIconOf(device: string | null): LucideIcon {
  return (device && DEVICE_ICONS[device]) || CircleHelp;
}

const NAME_SEPARATORS = /[._-]+/;
const MAX_INITIALS = 2;

/** "anita.sharma@libas.in" → "AS", "buyer@libas.in" → "B" (the local part only). */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? '';
  const initials = local
    .split(NAME_SEPARATORS)
    .filter(Boolean)
    .slice(0, MAX_INITIALS)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return initials || '?';
}
