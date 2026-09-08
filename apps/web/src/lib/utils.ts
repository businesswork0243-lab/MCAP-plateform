import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function formatRelative(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  const now   = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr  / 24);

  if (diffSec < 60)  return 'just now';
  if (diffMin < 60)  return `${diffMin}m ago`;
  if (diffHr  < 24)  return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7)   return `${diffDay}d ago`;
  if (diffDay < 30)  return `${Math.floor(diffDay / 7)}w ago`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}mo ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
}

export function formatDate(
  dateStr: string | Date,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  }
): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString('en-US', options);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

/**
 * Copy text to the clipboard, working outside a secure context.
 *
 * navigator.clipboard only exists on HTTPS or localhost. The app is served
 * over plain HTTP, so navigator.clipboard was undefined and every Copy button
 * threw a TypeError that nothing caught — the button simply did nothing.
 * Falls back to a hidden textarea plus execCommand, which works on HTTP.
 *
 * Returns whether the copy succeeded, so callers can show honest feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or a non-secure context — fall through.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Keep it off-screen and unfocusable so the page does not jump.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : null;

    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand('copy');

    document.body.removeChild(textarea);
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  } catch {
    return false;
  }
}
