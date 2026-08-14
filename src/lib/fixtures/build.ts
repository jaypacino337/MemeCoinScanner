import type { DiscoveredPost, MetricObservation, Platform } from '@/lib/domain/types';
import { FIXTURE_SEEDS, fixtureProfileUrl, fixtureUrl, type FixtureSeed, type GrowthShape } from './seeds';

/**
 * Turns the static seeds into DiscoveredPost objects with a snapshot history.
 *
 * The series is generated deterministically from the seed's declared growth
 * shape, relative to whatever "now" is passed in, so the demo data stays
 * plausibly recent without anyone hand-maintaining timestamps.
 *
 * Every observation produced here carries source SYNTHETIC_FIXTURE and
 * confidence UNVERIFIED. That flows into scoring (which applies the
 * unverified-metrics penalty) and into the UI, which labels the whole dataset
 * as demo content. These numbers are illustrative, not measurements.
 */

const MS_PER_DAY = 86_400_000;
const SNAPSHOT_COUNT = 6;

/** Fraction of final value reached at progress `t` (0..1) for each shape. */
function curve(shape: GrowthShape, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  switch (shape) {
    // Slow start, steep finish -> later intervals are faster -> ACCELERATING.
    case 'accelerating':
      return Math.pow(clamped, 2.0);
    case 'steady':
      return clamped;
    // Fast start, flattening tail -> DECAYING.
    case 'decaying':
      return Math.pow(clamped, 0.45);
  }
}

/**
 * Post time, anchored to midnight UTC of the current day rather than to the
 * exact moment of the call.
 *
 * This matters: if postedAt were always `now - postedDaysAgo`, a post's age
 * would be identical on every scan, its terminal view count would never move,
 * and two consecutive scans would record the same number — making every
 * measured velocity exactly zero. Anchoring to midnight lets a post genuinely
 * age across the day, so successive scans observe real growth, while the demo
 * set still resets to "recent" each day.
 */
export function fixturePostedAt(seed: FixtureSeed, now: Date): Date {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(midnight - seed.postedDaysAgo * MS_PER_DAY);
}

function buildObservations(seed: FixtureSeed, now: Date): MetricObservation[] {
  const postedAt = fixturePostedAt(seed, now);
  const ageMs = Math.max(now.getTime() - postedAt.getTime(), 1);

  // The seed's declared totals describe the post at "maturity", one day past
  // its anchor. Before that, the curve is still climbing, so the numbers move
  // between scans exactly as a live post's would.
  const matureAgeMs = (seed.postedDaysAgo + 1) * MS_PER_DAY;

  // Observations cover at most the last 7 days of the post's life, which is
  // what the growth chart displays.
  const windowMs = Math.min(ageMs, 7 * MS_PER_DAY);
  const windowStart = now.getTime() - windowMs;

  const observations: MetricObservation[] = [];

  for (let i = 0; i < SNAPSHOT_COUNT; i += 1) {
    const capturedAt = new Date(
      windowStart + (windowMs * i) / (SNAPSHOT_COUNT - 1),
    );
    // Progress measured from the post's own creation, not the window start, so
    // an older post already starts high.
    const progress = (capturedAt.getTime() - postedAt.getTime()) / matureAgeMs;
    const fraction = curve(seed.growth, progress);

    observations.push({
      capturedAt,
      views: Math.round(seed.finalViews * fraction),
      likes: Math.round(seed.finalLikes * fraction),
      comments: Math.round(seed.finalComments * fraction),
      shares: Math.round(seed.finalShares * fraction),
      followerCount: seed.followerCount,
      source: 'SYNTHETIC_FIXTURE',
      confidence: 'UNVERIFIED',
    });
  }

  return observations;
}

export function seedToDiscoveredPost(seed: FixtureSeed, now: Date): DiscoveredPost {
  const postedAt = fixturePostedAt(seed, now);

  return {
    account: {
      platform: seed.platform,
      handle: seed.handle,
      displayName: seed.displayName,
      profileUrl: fixtureProfileUrl(seed),
      avatarUrl: null,
      followerCount: seed.followerCount,
      verifiedAccount: seed.verifiedAccount,
      primaryLanguage: 'en',
    },
    post: {
      platform: seed.platform,
      platformPostId: seed.platformPostId,
      url: fixtureUrl(seed),
      caption: seed.caption,
      thumbnailUrl: null,
      embedUrl: seed.embedAllowed ? fixtureUrl(seed) : null,
      embedAllowed: seed.embedAllowed,
      postedAt,
      language: 'en',
      englishCommentRatio: seed.englishCommentRatio,
      hashtags: seed.hashtags,
    },
    metrics: buildObservations(seed, now),
    signals: {
      category: seed.category,
      memeClarity: seed.memeClarity,
      characterStrength: seed.characterStrength,
      pfpSuitability: seed.pfpSuitability,
      expandability: seed.expandability,
      originality: seed.originality,
      isStaleTrendRevival: seed.isStaleTrendRevival,
      sponsored: seed.sponsored,
      subject: seed.subject,
      memeHook: seed.memeHook,
      whyItLands: seed.whyItLands,
      mascotDirection: seed.mascotDirection,
      similarHistoricalMemes: seed.similarHistoricalMemes,
      communityContentIdeas: seed.communityContentIdeas,
      risks: seed.risks,
      knownAliases: seed.knownAliases,
    },
  };
}

export function fixturePostsForPlatform(platform: Platform, now: Date): DiscoveredPost[] {
  return FIXTURE_SEEDS.filter((s) => s.platform === platform).map((s) =>
    seedToDiscoveredPost(s, now),
  );
}

export function findFixtureByPostId(platformPostId: string): FixtureSeed | undefined {
  return FIXTURE_SEEDS.find((s) => s.platformPostId === platformPostId);
}
