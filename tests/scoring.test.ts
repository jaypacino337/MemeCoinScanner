import { describe, expect, it } from 'vitest';
import type { CreativeSignals, MetricObservation } from '@/lib/domain/types';
import {
  compareForRanking,
  MAX_SCORE,
  PENALTIES,
  SCORE_WEIGHTS,
  scoreCandidate,
  type ScoreInput,
} from '@/lib/pipeline/scoring';

const NOW = new Date('2026-08-14T12:00:00Z');

function observation(
  hoursAgo: number,
  views: number,
  overrides: Partial<MetricObservation> = {},
): MetricObservation {
  return {
    capturedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    views,
    likes: Math.round(views * 0.12),
    comments: Math.round(views * 0.003),
    shares: Math.round(views * 0.02),
    source: 'OFFICIAL_API',
    confidence: 'HIGH',
    ...overrides,
  };
}

const strongSignals: CreativeSignals = {
  category: 'ANIMAL',
  subject: 'commuter ferret',
  memeHook: 'A ferret sits upright on a train like a tired commuter.',
  whyItLands: 'Animal-as-office-worker reads instantly.',
  mascotDirection: 'Ferret with a briefcase.',
  memeClarity: 0.9,
  characterStrength: 0.9,
  pfpSuitability: 0.9,
  expandability: 0.8,
  originality: 0.85,
};

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    observations: [observation(48, 4_000_000), observation(24, 12_000_000), observation(0, 30_000_000)],
    postedAt: new Date(NOW.getTime() - 2 * 86_400_000),
    signals: strongSignals,
    screeningStatus: 'CLEAN',
    metricSource: 'OFFICIAL_API',
    confidence: 'HIGH',
    englishCommentRatio: 0.92,
    postLanguage: 'en',
    risks: [],
    sourceIsDirectAndReachable: true,
    now: NOW,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('keeps every component inside its published weight', () => {
    const result = scoreCandidate(baseInput());

    expect(result.components.virality).toBeLessThanOrEqual(SCORE_WEIGHTS.virality);
    expect(result.components.recency).toBeLessThanOrEqual(SCORE_WEIGHTS.recency);
    expect(result.components.clarity).toBeLessThanOrEqual(SCORE_WEIGHTS.clarity);
    expect(result.components.mascot).toBeLessThanOrEqual(SCORE_WEIGHTS.mascot);
    expect(result.components.pfp).toBeLessThanOrEqual(SCORE_WEIGHTS.pfp);
    expect(result.components.english).toBeLessThanOrEqual(SCORE_WEIGHTS.english);
    expect(result.components.originality).toBeLessThanOrEqual(SCORE_WEIGHTS.originality);
    expect(result.components.cleanScreen).toBeLessThanOrEqual(SCORE_WEIGHTS.cleanScreen);
    expect(result.opportunityScore).toBeLessThanOrEqual(MAX_SCORE);
    expect(result.opportunityScore).toBeGreaterThan(0);
  });

  it('scores a fresh, clean, high-view post well above a stale occupied one', () => {
    const strong = scoreCandidate(baseInput());
    const weak = scoreCandidate(
      baseInput({
        observations: [observation(200, 3_100_000), observation(100, 3_150_000), observation(0, 3_200_000)],
        postedAt: new Date(NOW.getTime() - 70 * 86_400_000),
        screeningStatus: 'OCCUPIED',
        signals: { ...strongSignals, isStaleTrendRevival: true, originality: 0.1 },
      }),
    );

    expect(strong.opportunityScore).toBeGreaterThan(weak.opportunityScore + 25);
  });

  it('applies the unverified-metrics penalty for synthetic fixture data', () => {
    const verified = scoreCandidate(baseInput());
    const synthetic = scoreCandidate(
      baseInput({ metricSource: 'SYNTHETIC_FIXTURE', confidence: 'UNVERIFIED' }),
    );

    const penalty = synthetic.penalties.find((p) => p.reason.includes('not independently verified'));
    expect(penalty?.points).toBe(PENALTIES.unverifiedMetrics);
    expect(synthetic.opportunityScore).toBeLessThan(verified.opportunityScore);
  });

  it('awards zero clean-screen points when the ticker is occupied and penalises it', () => {
    const occupied = scoreCandidate(baseInput({ screeningStatus: 'OCCUPIED' }));

    expect(occupied.components.cleanScreen).toBe(0);
    expect(occupied.penalties.some((p) => p.points === PENALTIES.occupiedToken)).toBe(true);
  });

  it('gives partial clean-screen credit for DUST_ONLY and UNCERTAIN', () => {
    const dust = scoreCandidate(baseInput({ screeningStatus: 'DUST_ONLY' }));
    const uncertain = scoreCandidate(baseInput({ screeningStatus: 'UNCERTAIN' }));

    expect(dust.components.cleanScreen).toBeCloseTo(SCORE_WEIGHTS.cleanScreen * 0.5, 5);
    expect(uncertain.components.cleanScreen).toBeCloseTo(SCORE_WEIGHTS.cleanScreen * 0.25, 5);
  });

  it('excludes a candidate whose source link is broken or indirect', () => {
    const result = scoreCandidate(baseInput({ sourceIsDirectAndReachable: false }));

    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toBe('BROKEN_OR_INDIRECT_SOURCE');
  });

  it('excludes a generic post with no readable joke and no character', () => {
    const result = scoreCandidate(
      baseInput({
        signals: { ...strongSignals, memeClarity: 0.1, characterStrength: 0.1 },
      }),
    );

    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toBe('GENERIC_NO_CENTRAL_JOKE');
  });

  it('excludes content flagged with an EXCLUDE-severity risk', () => {
    const result = scoreCandidate(
      baseInput({
        risks: [
          { kind: 'TRAGEDY', severity: 'EXCLUDE', note: 'References a death.' },
        ],
      }),
    );

    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toBe('VULNERABLE_SUBJECT');
  });

  it('flags sponsored content with a penalty rather than excluding it', () => {
    const result = scoreCandidate(
      baseInput({ signals: { ...strongSignals, sponsored: true } }),
    );

    expect(result.excluded).toBe(false);
    expect(result.penalties.some((p) => p.points === PENALTIES.sponsoredContent)).toBe(true);
  });

  it('penalises celebrity and copyright dependence', () => {
    const result = scoreCandidate(
      baseInput({
        risks: [
          { kind: 'COPYRIGHT', severity: 'FLAG', note: 'Uses a protected character.' },
        ],
      }),
    );

    expect(
      result.penalties.some((p) => p.points === PENALTIES.celebrityOrIpDependence),
    ).toBe(true);
  });

  it('awards no velocity credit when only one snapshot exists', () => {
    const single = scoreCandidate(
      baseInput({ observations: [observation(0, 30_000_000)] }),
    );

    expect(single.velocity.viewsPerHour).toBeNull();
    // Lifetime rate still exists, so recency is not zero — but it is lower than
    // the same post with a measured interval rate.
    expect(single.components.recency).toBeGreaterThan(0);
    expect(single.velocity.snapshotCount).toBe(1);
  });

  it('never returns a negative score even under stacked penalties', () => {
    const result = scoreCandidate(
      baseInput({
        observations: [observation(0, 1_100_000)],
        postedAt: new Date(NOW.getTime() - 89 * 86_400_000),
        screeningStatus: 'OCCUPIED',
        metricSource: 'ESTIMATED',
        confidence: 'UNVERIFIED',
        englishCommentRatio: 0,
        postLanguage: 'ja',
        signals: {
          ...strongSignals,
          isStaleTrendRevival: true,
          sponsored: true,
          memeClarity: 0.3,
          characterStrength: 0.3,
          originality: 0.05,
        },
        risks: [
          { kind: 'COPYRIGHT', severity: 'FLAG', note: 'IP risk' },
          { kind: 'WEAK_SOURCING', severity: 'FLAG', note: 'Aggregator only' },
        ],
      }),
    );

    expect(result.opportunityScore).toBeGreaterThanOrEqual(0);
  });

  it('treats unknown creative signals as partial credit, not full credit', () => {
    const known = scoreCandidate(baseInput());
    const unknown = scoreCandidate(
      baseInput({
        signals: {
          category: 'OTHER',
          subject: 'unknown thing',
          memeHook: 'hook',
          whyItLands: 'because',
          mascotDirection: 'none',
        },
      }),
    );

    expect(unknown.components.clarity).toBeLessThan(known.components.clarity);
    expect(unknown.components.clarity).toBeGreaterThan(0);
  });
});

describe('compareForRanking', () => {
  it('ranks verified candidates above unverified ones regardless of score', () => {
    const list = [
      { opportunityScore: 95, verificationState: 'UNVERIFIED' },
      { opportunityScore: 40, verificationState: 'VERIFIED' },
      { opportunityScore: 60, verificationState: 'PARTIALLY_VERIFIED' },
    ];

    const sorted = [...list].sort(compareForRanking);

    expect(sorted[0]?.verificationState).toBe('VERIFIED');
    expect(sorted[1]?.verificationState).toBe('PARTIALLY_VERIFIED');
    expect(sorted[2]?.verificationState).toBe('UNVERIFIED');
  });

  it('orders by score within the same verification tier', () => {
    const list = [
      { opportunityScore: 40, verificationState: 'VERIFIED' },
      { opportunityScore: 80, verificationState: 'VERIFIED' },
    ];

    expect([...list].sort(compareForRanking)[0]?.opportunityScore).toBe(80);
  });
});
