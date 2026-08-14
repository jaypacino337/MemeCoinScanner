import type { DiscoveredPost, DiscoveryFilters, RiskNoteInput } from '@/lib/domain/types';
import { latestObservation } from './velocity';

/**
 * Threshold filtering.
 *
 * Filters are applied *before* the expensive stages (link verification and
 * duplicate screening) so a scan does not spend upstream budget on posts the
 * user has already excluded.
 */

export interface FilterOutcome {
  passed: boolean;
  reason: string | null;
}

const ANIMAL_CATEGORIES = new Set(['ANIMAL', 'CAT_OR_DOG']);

/** Risk kinds that mean "celebrity or IP entanglement" for the filter toggle. */
const IP_RISK_KINDS = new Set(['COPYRIGHT', 'IDENTITY', 'AFFILIATION']);

export function applyFilters(
  discovered: DiscoveredPost,
  filters: DiscoveryFilters,
  risks: RiskNoteInput[],
  now: Date = new Date(),
): FilterOutcome {
  const { post, account, signals } = discovered;
  const latest = latestObservation(discovered.metrics);

  const ageDays = (now.getTime() - post.postedAt.getTime()) / 86_400_000;
  if (ageDays > filters.windowDays) {
    return { passed: false, reason: `Older than the ${filters.windowDays}-day window` };
  }
  if (ageDays < 0) {
    return { passed: false, reason: 'Post date is in the future' };
  }

  if (!filters.platforms.includes(post.platform)) {
    return { passed: false, reason: `Platform ${post.platform} not selected` };
  }

  const views = latest?.views ?? null;
  if (filters.minViews > 0) {
    if (views === null) {
      return { passed: false, reason: 'No view count available to test against the minimum' };
    }
    if (views < filters.minViews) {
      return {
        passed: false,
        reason: `${views.toLocaleString()} views is below the ${filters.minViews.toLocaleString()} minimum`,
      };
    }
  }

  const likes = latest?.likes ?? null;
  if (filters.minLikes > 0 && (likes === null || likes < filters.minLikes)) {
    return {
      passed: false,
      reason: `Below the ${filters.minLikes.toLocaleString()} like minimum`,
    };
  }

  const followers = account.followerCount ?? null;
  if (filters.minFollowers > 0 && (followers === null || followers < filters.minFollowers)) {
    return {
      passed: false,
      reason: `Account below the ${filters.minFollowers.toLocaleString()} follower minimum`,
    };
  }

  if (filters.categories.length > 0 && !filters.categories.includes(signals.category)) {
    return { passed: false, reason: `Category ${signals.category} not selected` };
  }

  if (filters.catsAndDogsOnly && signals.category !== 'CAT_OR_DOG') {
    return { passed: false, reason: 'Not a cat or dog post' };
  }

  if (filters.animalsOnly && !ANIMAL_CATEGORIES.has(signals.category)) {
    return { passed: false, reason: 'Not an animal post' };
  }

  if (filters.requireEnglishAudience) {
    const ratio = post.englishCommentRatio;
    const languageIsEnglish = post.language?.toLowerCase().startsWith('en') ?? false;
    if (ratio !== null && ratio !== undefined) {
      if (ratio < 0.5) {
        return {
          passed: false,
          reason: `English comment share ${(ratio * 100).toFixed(0)}% is below 50%`,
        };
      }
    } else if (!languageIsEnglish) {
      return { passed: false, reason: 'No evidence of an English-speaking audience' };
    }
  }

  if (filters.pfpFriendlyOnly) {
    const pfp = signals.pfpSuitability;
    if (pfp === undefined || pfp < 0.6) {
      return { passed: false, reason: 'Not clearly suitable as a profile picture' };
    }
  }

  if (filters.noCelebrityOrIpRisk && risks.some((r) => IP_RISK_KINDS.has(r.kind))) {
    return { passed: false, reason: 'Carries celebrity or intellectual-property risk' };
  }

  if (filters.signalStage !== 'any' && views !== null) {
    // "early" wants posts still climbing and not yet saturated; "giga" wants
    // the already-huge ones.
    const GIGA_THRESHOLD = 25_000_000;
    if (filters.signalStage === 'early' && views > GIGA_THRESHOLD) {
      return { passed: false, reason: 'Already past the early-signal stage' };
    }
    if (filters.signalStage === 'giga' && views < GIGA_THRESHOLD) {
      return { passed: false, reason: 'Below the already-giga-viral threshold' };
    }
  }

  return { passed: true, reason: null };
}

/**
 * Derives risk notes the provider did not supply. Keyword-based and deliberately
 * conservative — it flags for human review rather than silently excluding.
 */
export function deriveRisks(discovered: DiscoveredPost): RiskNoteInput[] {
  const risks: RiskNoteInput[] = [...(discovered.signals.risks ?? [])];
  const haystack = `${discovered.post.caption ?? ''} ${discovered.signals.subject} ${discovered.signals.memeHook}`.toLowerCase();

  const add = (risk: RiskNoteInput): void => {
    if (!risks.some((r) => r.kind === risk.kind)) risks.push(risk);
  };

  const TRAGEDY_TERMS = ['died', 'death', 'funeral', 'passed away', 'killed', 'cancer', 'hospice', 'terminal illness', 'shooting', 'crash victim'];
  if (TRAGEDY_TERMS.some((t) => haystack.includes(t))) {
    add({
      kind: 'TRAGEDY',
      severity: 'EXCLUDE',
      note: 'Content references death, serious illness, or a tragedy — not appropriate to build a token around.',
    });
  }

  const POLITICS_TERMS = ['election', 'president', 'senator', 'parliament', 'campaign rally', 'candidate', '政治'];
  if (POLITICS_TERMS.some((t) => haystack.includes(t))) {
    add({
      kind: 'POLITICS',
      severity: 'FLAG',
      note: 'Political subject matter — divisive and legally sensitive in several jurisdictions.',
    });
  }

  if (discovered.signals.sponsored || haystack.includes('#ad') || haystack.includes('sponsored')) {
    add({
      kind: 'SPONSORED',
      severity: 'FLAG',
      note: 'Appears to be a paid campaign; reach is bought rather than organic.',
    });
  }

  if (discovered.metrics.every((m) => m.source === 'ESTIMATED' || m.source === 'THIRD_PARTY_AGGREGATOR')) {
    add({
      kind: 'WEAK_SOURCING',
      severity: 'FLAG',
      note: 'All metrics come from a third-party aggregator rather than the platform itself.',
    });
  }

  return risks;
}
