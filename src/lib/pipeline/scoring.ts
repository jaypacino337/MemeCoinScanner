import type {
  ConfidenceLevel,
  CreativeSignals,
  MetricObservation,
  MetricSource,
  RiskNoteInput,
  ScreeningStatus,
} from '@/lib/domain/types';
import { computeVelocity, latestObservation, type VelocityReport } from './velocity';

/**
 * The 100-point opportunity model.
 *
 * Weights are fixed by the product spec and exported so the UI can render the
 * same breakdown it scores with — there is no second, hidden model.
 */
export const SCORE_WEIGHTS = {
  virality: 25,
  recency: 20,
  clarity: 15,
  mascot: 15,
  pfp: 10,
  english: 5,
  originality: 5,
  cleanScreen: 5,
} as const;

export const MAX_SCORE = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

/** Penalties are subtracted after the positive components are summed. */
export const PENALTIES = {
  unverifiedMetrics: 18,
  staleTrendNoResurgence: 15,
  occupiedToken: 20,
  dustOnlyToken: 6,
  uncertainScreen: 5,
  sponsoredContent: 8,
  celebrityOrIpDependence: 10,
  weakSourcing: 6,
  flaggedRisk: 4,
} as const;

export type ExclusionReason =
  | 'BROKEN_OR_INDIRECT_SOURCE'
  | 'GENERIC_NO_CENTRAL_JOKE'
  | 'VULNERABLE_SUBJECT'
  | 'BELOW_THRESHOLD';

export interface ScoreComponents {
  virality: number;
  recency: number;
  clarity: number;
  mascot: number;
  pfp: number;
  english: number;
  originality: number;
  cleanScreen: number;
}

export interface PenaltyEntry {
  reason: string;
  points: number;
}

export interface ScoreResult {
  components: ScoreComponents;
  rawTotal: number;
  penalties: PenaltyEntry[];
  penaltyTotal: number;
  opportunityScore: number;
  /** Set when the candidate must not be displayed at all. */
  excluded: boolean;
  exclusionReason: ExclusionReason | null;
  /** Normalised 0..100 badges for the UI. */
  memeabilityScore: number;
  viralityScore100: number;
  freshnessScore100: number;
  pfpPotentialScore100: number;
  velocity: VelocityReport;
}

export interface ScoreInput {
  observations: MetricObservation[];
  postedAt: Date;
  signals: CreativeSignals;
  screeningStatus: ScreeningStatus;
  metricSource: MetricSource;
  confidence: ConfidenceLevel;
  englishCommentRatio?: number | null;
  postLanguage?: string | null;
  risks: RiskNoteInput[];
  /** Result of URL verification; a failed check is a hard exclude. */
  sourceIsDirectAndReachable: boolean;
  now?: Date;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Log-scaled view credit. Linear scaling would let one 400M-view post crowd out
 * everything else; log scaling keeps the range meaningful across 1M–500M.
 */
function viralityComponent(views: number | null | undefined): number {
  if (views === null || views === undefined || views <= 0) return 0;
  const floor = 1_000_000;
  const ceiling = 200_000_000;
  if (views <= floor) return SCORE_WEIGHTS.virality * 0.15;
  const ratio =
    Math.log10(Math.min(views, ceiling) / floor) / Math.log10(ceiling / floor);
  return SCORE_WEIGHTS.virality * clamp(0.15 + 0.85 * ratio, 0, 1);
}

/**
 * Recency and velocity share the 20-point band: 60% for how new the post is,
 * 40% for how fast it is still moving.
 */
function recencyComponent(postedAt: Date, velocity: VelocityReport, now: Date): number {
  const ageDays = (now.getTime() - postedAt.getTime()) / 86_400_000;
  let freshness: number;
  if (ageDays <= 2) freshness = 1;
  else if (ageDays <= 7) freshness = 1 - (ageDays - 2) / 5 * 0.35; // 1.0 -> 0.65
  else if (ageDays <= 14) freshness = 0.65 - (ageDays - 7) / 7 * 0.3; // 0.65 -> 0.35
  else if (ageDays <= 90) freshness = clamp(0.35 - (ageDays - 14) / 76 * 0.3, 0.05, 0.35);
  else freshness = 0.05;

  const rate = velocity.viewsPerHour ?? velocity.lifetimeViewsPerHour;
  let velocityScore: number;
  if (rate === null || rate === undefined) {
    // No usable rate: award nothing for velocity rather than guessing.
    velocityScore = 0;
  } else {
    // 50k views/hour is treated as a strong sustained rate.
    velocityScore = clamp(Math.log10(1 + rate) / Math.log10(1 + 50_000), 0, 1);
  }

  return SCORE_WEIGHTS.recency * (freshness * 0.6 + velocityScore * 0.4);
}

function signalComponent(value: number | undefined, weight: number, unknownFactor = 0.4): number {
  if (value === undefined || Number.isNaN(value)) return weight * unknownFactor;
  return weight * clamp(value, 0, 1);
}

function englishComponent(
  ratio: number | null | undefined,
  language: string | null | undefined,
): number {
  if (ratio !== null && ratio !== undefined) {
    return SCORE_WEIGHTS.english * clamp(ratio, 0, 1);
  }
  if (language && language.toLowerCase().startsWith('en')) {
    // Post language is weaker evidence than sampled comments.
    return SCORE_WEIGHTS.english * 0.7;
  }
  return 0;
}

function cleanScreenComponent(status: ScreeningStatus): number {
  switch (status) {
    case 'CLEAN':
      return SCORE_WEIGHTS.cleanScreen;
    case 'DUST_ONLY':
      return SCORE_WEIGHTS.cleanScreen * 0.5;
    case 'UNCERTAIN':
      return SCORE_WEIGHTS.cleanScreen * 0.25;
    case 'OCCUPIED':
      return 0;
  }
}

function metricsAreVerified(source: MetricSource, confidence: ConfidenceLevel): boolean {
  const trustedSource = source === 'OFFICIAL_API' || source === 'PUBLIC_PAGE';
  const trustedConfidence = confidence === 'HIGH' || confidence === 'MEDIUM';
  return trustedSource && trustedConfidence;
}

export function scoreCandidate(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date();
  const velocity = computeVelocity(input.observations, input.postedAt, now);
  const latest = latestObservation(input.observations);
  const views = latest?.views ?? null;

  const components: ScoreComponents = {
    virality: viralityComponent(views),
    recency: recencyComponent(input.postedAt, velocity, now),
    clarity: signalComponent(input.signals.memeClarity, SCORE_WEIGHTS.clarity),
    mascot: signalComponent(input.signals.characterStrength, SCORE_WEIGHTS.mascot),
    pfp:
      signalComponent(input.signals.pfpSuitability, SCORE_WEIGHTS.pfp * 0.6) +
      signalComponent(input.signals.expandability, SCORE_WEIGHTS.pfp * 0.4),
    english: englishComponent(input.englishCommentRatio, input.postLanguage),
    originality: signalComponent(input.signals.originality, SCORE_WEIGHTS.originality),
    cleanScreen: cleanScreenComponent(input.screeningStatus),
  };

  const rawTotal = Object.values(components).reduce((a, b) => a + b, 0);

  // --- Penalties ---
  const penalties: PenaltyEntry[] = [];

  if (!metricsAreVerified(input.metricSource, input.confidence)) {
    penalties.push({
      reason: `Metrics not independently verified (source: ${input.metricSource}, confidence: ${input.confidence})`,
      points: PENALTIES.unverifiedMetrics,
    });
  }

  if (input.signals.isStaleTrendRevival) {
    penalties.push({
      reason: 'Older trend with no measured current resurgence',
      points: PENALTIES.staleTrendNoResurgence,
    });
  }

  if (input.screeningStatus === 'OCCUPIED') {
    penalties.push({
      reason: 'An established token already uses this name, ticker, or subject',
      points: PENALTIES.occupiedToken,
    });
  } else if (input.screeningStatus === 'DUST_ONLY') {
    penalties.push({
      reason: 'Close token matches exist but show no meaningful traction',
      points: PENALTIES.dustOnlyToken,
    });
  } else if (input.screeningStatus === 'UNCERTAIN') {
    penalties.push({
      reason: 'Token index screening was incomplete',
      points: PENALTIES.uncertainScreen,
    });
  }

  if (input.signals.sponsored) {
    penalties.push({
      reason: 'Appears to be a sponsored campaign',
      points: PENALTIES.sponsoredContent,
    });
  }

  for (const risk of input.risks) {
    if (risk.severity === 'EXCLUDE') continue; // handled as a hard exclude below
    if (risk.kind === 'COPYRIGHT' || risk.kind === 'IDENTITY') {
      penalties.push({
        reason: `Depends on celebrity or copyrighted material: ${risk.note}`,
        points: PENALTIES.celebrityOrIpDependence,
      });
    } else if (risk.kind === 'WEAK_SOURCING') {
      penalties.push({ reason: risk.note, points: PENALTIES.weakSourcing });
    } else if (risk.severity === 'FLAG') {
      penalties.push({ reason: risk.note, points: PENALTIES.flaggedRisk });
    }
  }

  const penaltyTotal = penalties.reduce((sum, p) => sum + p.points, 0);

  // --- Hard exclusions ---
  let excluded = false;
  let exclusionReason: ExclusionReason | null = null;

  if (!input.sourceIsDirectAndReachable) {
    excluded = true;
    exclusionReason = 'BROKEN_OR_INDIRECT_SOURCE';
  } else if (input.risks.some((r) => r.severity === 'EXCLUDE')) {
    excluded = true;
    exclusionReason = 'VULNERABLE_SUBJECT';
  } else if (
    input.signals.memeClarity !== undefined &&
    input.signals.memeClarity < 0.25 &&
    (input.signals.characterStrength ?? 0) < 0.25
  ) {
    // No readable joke and no character to build on: nothing to work with.
    excluded = true;
    exclusionReason = 'GENERIC_NO_CENTRAL_JOKE';
  }

  const opportunityScore = clamp(rawTotal - penaltyTotal, 0, MAX_SCORE);

  return {
    components: {
      virality: round2(components.virality),
      recency: round2(components.recency),
      clarity: round2(components.clarity),
      mascot: round2(components.mascot),
      pfp: round2(components.pfp),
      english: round2(components.english),
      originality: round2(components.originality),
      cleanScreen: round2(components.cleanScreen),
    },
    rawTotal: round2(rawTotal),
    penalties,
    penaltyTotal: round2(penaltyTotal),
    opportunityScore: round2(opportunityScore),
    excluded,
    exclusionReason,
    memeabilityScore: round2(
      ((components.clarity / SCORE_WEIGHTS.clarity) * 0.6 +
        (components.mascot / SCORE_WEIGHTS.mascot) * 0.4) *
        100,
    ),
    viralityScore100: round2((components.virality / SCORE_WEIGHTS.virality) * 100),
    freshnessScore100: round2((components.recency / SCORE_WEIGHTS.recency) * 100),
    pfpPotentialScore100: round2((components.pfp / SCORE_WEIGHTS.pfp) * 100),
    velocity,
  };
}

/**
 * Ranking comparator. Verified candidates always sort above unverified ones
 * regardless of score, as required by the data-integrity rules.
 */
export function compareForRanking(
  a: { opportunityScore: number; verificationState: string },
  b: { opportunityScore: number; verificationState: string },
): number {
  const rank = (state: string): number => {
    if (state === 'VERIFIED') return 0;
    if (state === 'PARTIALLY_VERIFIED') return 1;
    return 2;
  };
  const byVerification = rank(a.verificationState) - rank(b.verificationState);
  if (byVerification !== 0) return byVerification;
  return b.opportunityScore - a.opportunityScore;
}
