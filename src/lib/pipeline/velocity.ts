import type { MetricObservation, MomentumTrend } from '@/lib/domain/types';

/**
 * Growth math derived strictly from stored snapshots.
 *
 * If there is only one observation we return nulls rather than inventing a
 * velocity — a single data point cannot express a rate of change, and the UI
 * shows "insufficient history" instead of a fabricated number.
 */

export interface VelocityReport {
  viewsPerHour: number | null;
  likesPerHour: number | null;
  commentsPerHour: number | null;
  /** Change in views/hour between the two most recent intervals. */
  engagementAcceleration: number | null;
  momentum: MomentumTrend;
  /** Views ÷ hours since posting. Available with a single snapshot. */
  lifetimeViewsPerHour: number | null;
  engagementRate: number | null;
  snapshotCount: number;
  observedHours: number | null;
}

const MS_PER_HOUR = 3_600_000;

function sortByTime(observations: MetricObservation[]): MetricObservation[] {
  return [...observations].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

function ratePerHour(
  earlier: MetricObservation,
  later: MetricObservation,
  field: 'views' | 'likes' | 'comments',
): number | null {
  const a = earlier[field];
  const b = later[field];
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const hours = (later.capturedAt.getTime() - earlier.capturedAt.getTime()) / MS_PER_HOUR;
  if (hours <= 0) return null;
  // Counters can be revised downward by platforms; clamp so we never report
  // negative "growth" as if it were a real audience movement.
  return Math.max(0, (b - a) / hours);
}

/** Total engagement ÷ views, expressed 0..1. Null when views are unknown/zero. */
export function engagementRate(latest: MetricObservation | undefined): number | null {
  if (!latest) return null;
  const { views, likes, comments, shares } = latest;
  if (views === null || views === undefined || views <= 0) return null;
  const interactions = (likes ?? 0) + (comments ?? 0) + (shares ?? 0);
  return interactions / views;
}

export function computeVelocity(
  observations: MetricObservation[],
  postedAt: Date,
  now: Date = new Date(),
): VelocityReport {
  const sorted = sortByTime(observations);
  const latest = sorted[sorted.length - 1];
  const first = sorted[0];

  const base: VelocityReport = {
    viewsPerHour: null,
    likesPerHour: null,
    commentsPerHour: null,
    engagementAcceleration: null,
    momentum: 'UNKNOWN',
    lifetimeViewsPerHour: null,
    engagementRate: engagementRate(latest),
    snapshotCount: sorted.length,
    observedHours: null,
  };

  if (!latest || !first) return base;

  const ageHours = (now.getTime() - postedAt.getTime()) / MS_PER_HOUR;
  if (latest.views !== null && latest.views !== undefined && ageHours > 0) {
    base.lifetimeViewsPerHour = latest.views / ageHours;
  }

  if (sorted.length < 2) return base;

  const previous = sorted[sorted.length - 2];
  if (!previous) return base;

  base.observedHours = (latest.capturedAt.getTime() - first.capturedAt.getTime()) / MS_PER_HOUR;
  base.viewsPerHour = ratePerHour(previous, latest, 'views');
  base.likesPerHour = ratePerHour(previous, latest, 'likes');
  base.commentsPerHour = ratePerHour(previous, latest, 'comments');

  // Acceleration needs three points: two consecutive intervals to compare.
  if (sorted.length >= 3) {
    const earlier = sorted[sorted.length - 3];
    if (earlier) {
      const recentRate = base.viewsPerHour;
      const priorRate = ratePerHour(earlier, previous, 'views');
      if (recentRate !== null && priorRate !== null) {
        base.engagementAcceleration = recentRate - priorRate;
        if (priorRate === 0) {
          base.momentum = recentRate > 0 ? 'ACCELERATING' : 'STEADY';
        } else {
          const change = (recentRate - priorRate) / priorRate;
          if (change > 0.15) base.momentum = 'ACCELERATING';
          else if (change < -0.25) base.momentum = 'DECAYING';
          else base.momentum = 'STEADY';
        }
      }
    }
  }

  return base;
}

export interface GrowthPoint {
  capturedAt: Date;
  views: number | null;
  likes: number | null;
}

/**
 * Seven-day curve for the detail-page chart. Returns the real observations
 * inside the window — no interpolation, so gaps in coverage stay visible.
 */
export function sevenDayCurve(
  observations: MetricObservation[],
  now: Date = new Date(),
): GrowthPoint[] {
  const cutoff = now.getTime() - 7 * 24 * MS_PER_HOUR;
  return sortByTime(observations)
    .filter((o) => o.capturedAt.getTime() >= cutoff)
    .map((o) => ({ capturedAt: o.capturedAt, views: o.views, likes: o.likes }));
}

export function latestObservation(
  observations: MetricObservation[],
): MetricObservation | undefined {
  return sortByTime(observations)[observations.length - 1];
}
