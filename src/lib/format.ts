/**
 * Display formatting.
 *
 * Every helper distinguishes "zero" from "not known". A missing metric renders
 * as an explicit dash with a tooltip rather than as 0, so the UI never implies
 * a measurement that does not exist.
 */

export const UNKNOWN = '—';

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export function formatExact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;
  return value.toLocaleString('en-US');
}

export function formatRate(value: number | null | undefined, unit = '/hr'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;
  return `${formatCount(value)}${unit}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function relativeTime(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return UNKNOWN;
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (Number.isNaN(minutes)) return UNKNOWN;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return UNKNOWN;
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return UNKNOWN;
  return value.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
    .join(' ');
}
