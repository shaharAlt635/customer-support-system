import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

export function formatDate(value: string | Date): string {
  return format(new Date(value), 'MMM d, yyyy');
}

export function formatDateTime(value: string | Date): string {
  return format(new Date(value), "MMM d, yyyy 'at' HH:mm");
}

/** "5 minutes ago", "Yesterday at 14:02", "Mar 3, 2026". */
export function formatRelative(value: string | Date): string {
  const date = new Date(value);
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 60_000) return 'just now';
  if (isToday(date)) return `${formatDistanceToNowStrict(date)} ago`;
  if (isYesterday(date)) return `Yesterday at ${format(date, 'HH:mm')}`;
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return format(date, "EEE 'at' HH:mm");
  return formatDate(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** 135 → "2h 15m", 2880 → "2d". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(minutes - h * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours - days * 24);
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
