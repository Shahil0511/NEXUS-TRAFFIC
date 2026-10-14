'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** How long the check icon (and "Copied" label) stays after a copy. */
export const COPIED_FEEDBACK_MS = 2000;

/**
 * The legacy copy path for browsers/contexts without the async Clipboard API (plain-http
 * intranet hosts are not a "secure context"). The temporary textarea is mounted next to the
 * trigger, not on <body>, so a dialog's focus trap does not steal the selection; focus returns
 * to where it was.
 */
function copyWithTextarea(value: string, host: HTMLElement): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  host.appendChild(textarea);
  try {
    textarea.select();
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus?.();
  }
}

/**
 * WHY: one clipboard helper for the whole dashboard — the async Clipboard API first, the
 * textarea + execCommand fallback second. Resolves to whether the copy happened; it never logs
 * or stores the value (it may be a key).
 */
export async function copyToClipboard(
  value: string,
  host: HTMLElement = document.body,
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied / not focused: try the legacy path below.
    }
  }
  return copyWithTextarea(value, host);
}

export interface CopyButtonProps {
  /** The exact string put on the clipboard. Never logged, never rendered as an attribute. */
  value: string;
  /** What is copied, for the accessible name: "request id" → "Copy request id". */
  label: string;
  /** Show "Copy"/"Copied" next to the icon (an outline button) instead of an icon-only button. */
  showText?: boolean;
  /** Told whether each copy worked, e.g. to show an inline "copy it manually" hint. */
  onCopyResult?: (ok: boolean) => void;
  className?: string;
}

/**
 * WHY: support staff quote request ids, session ids, app slugs and keys; selecting truncated mono
 * text by hand is error-prone. One click copies the full value, the icon turns into a check and a
 * toast confirms — icon + text, never colour alone.
 */
export function CopyButton({
  value,
  label,
  showText = false,
  onCopyResult,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation(); // a copy inside a clickable row must not open the row
    const host = event.currentTarget.parentElement ?? document.body;
    const ok = await copyToClipboard(value, host);
    onCopyResult?.(ok);
    if (!ok) {
      toast.error('The browser blocked the clipboard — select the text and copy it manually.');
      return;
    }
    toast.success('Copied');
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  const Icon = copied ? Check : Copy;
  return (
    <Button
      type="button"
      variant={showText ? 'outline' : 'ghost'}
      size={showText ? 'default' : 'icon'}
      aria-label={`${copied ? 'Copied' : 'Copy'} ${label}`}
      title={showText ? undefined : `Copy ${label}`}
      onClick={(event) => void onClick(event)}
      className={cn(
        !showText && 'size-6 rounded-md text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <Icon
        className={cn(showText ? 'size-4' : 'size-3.5', copied && 'text-success')}
        aria-hidden="true"
      />
      {showText ? (copied ? 'Copied' : 'Copy') : null}
    </Button>
  );
}

export interface CopyableTextProps {
  /** The full value: copied, and shown as the tooltip when the text is truncated. */
  value: string;
  /** What is copied ("session id"), for the button's accessible name. */
  label: string;
  /** What to show instead of the full value (e.g. a shortened id); defaults to `value`. */
  children?: ReactNode;
  className?: string;
  textClassName?: string;
}

/**
 * WHY: an identifier shown where it may be truncated (mono text + title with the full value),
 * with a copy button beside it so the full value is always one click away. Use for ids and
 * slugs only — never emails or other personal data (the title is visible on hover).
 */
export function CopyableText({
  value,
  label,
  children,
  className,
  textClassName,
}: CopyableTextProps) {
  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-0.5', className)}>
      <span className={cn('min-w-0 truncate font-mono', textClassName)} title={value}>
        {children ?? value}
      </span>
      <CopyButton value={value} label={label} className="shrink-0" />
    </span>
  );
}
