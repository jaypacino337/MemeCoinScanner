import type { Prisma } from '@prisma/client';
import type {
  ConfidenceLevel,
  ContentCategory,
  LinkHealth,
  MetricObservation,
  MetricSource,
  MomentumTrend,
  Platform,
  ScreeningStatus,
  VerificationState,
} from '@/lib/domain/types';
import { computeMeta, type MetaReport } from '@/lib/pipeline/meta';
import { compareForRanking } from '@/lib/pipeline/scoring';
import { computeVelocity, sevenDayCurve, type VelocityReport } from '@/lib/pipeline/velocity';
import { bigIntToNumber, prisma } from './db';

/**
 * Read layer.
 *
 * All growth figures are recomputed from stored snapshots here rather than
 * being read from a denormalised column, so the numbers on screen always
 * correspond to observations that actually exist in the database.
 */

export interface ConceptView {
  id: string;
  name: string;
  ticker: string;
  rationale: string;
  isPrimary: boolean;
  screeningStatus: ScreeningStatus;
  searchedQueries: string[];
  searchedAt: Date | null;
  results: Array<{
    id: string;
    matchType: string;
    tokenName: string;
    tokenTicker: string;
    tokenUrl: string | null;
    mintAddress: string | null;
    marketCapUsd: number | null;
    athMarketCapUsd: number | null;
    createdOnIndexAt: Date | null;
    holders: number | null;
    quality: string;
    source: MetricSource;
    confidence: ConfidenceLevel;
  }>;
}

export interface CandidateView {
  id: string;
  platform: Platform;
  category: ContentCategory;
  url: string;
  caption: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  embedAllowed: boolean;
  postedAt: Date;
  hashtags: string[];
  englishCommentRatio: number | null;

  account: {
    handle: string;
    displayName: string | null;
    profileUrl: string;
    followerCount: number | null;
    verifiedAccount: boolean;
  };

  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    capturedAt: Date | null;
  };

  velocity: VelocityReport;
  growthCurve: Array<{ capturedAt: Date; views: number | null; likes: number | null }>;
  momentum: MomentumTrend;

  memeHook: string;
  whyItLands: string;
  mascotDirection: string;
  similarHistoricalMemes: string[];
  communityContentIdeas: string[];

  scores: {
    opportunity: number;
    memeability: number;
    virality: number;
    freshness: number;
    pfpPotential: number;
    breakdown: {
      virality: number;
      recency: number;
      clarity: number;
      mascot: number;
      pfp: number;
      english: number;
      originality: number;
      cleanScreen: number;
      penalty: number;
    };
  };

  verificationState: VerificationState;
  linkHealth: LinkHealth;
  lastVerifiedAt: Date | null;
  metricSource: MetricSource;
  confidence: ConfidenceLevel;

  screeningStatus: ScreeningStatus;
  concepts: ConceptView[];
  risks: Array<{ id: string; kind: string; severity: string; note: string }>;

  saved: boolean;
  rejected: boolean;
  rejectionReason: string | null;
}

const candidateInclude = {
  post: {
    include: {
      account: true,
      snapshots: { orderBy: { capturedAt: 'asc' } },
    },
  },
  concepts: { include: { results: true }, orderBy: { isPrimary: 'desc' } },
  risks: true,
  savedIdeas: true,
  rejections: true,
} satisfies Prisma.ViralCandidateInclude;

type CandidateRow = Prisma.ViralCandidateGetPayload<{ include: typeof candidateInclude }>;

function toObservation(snapshot: CandidateRow['post']['snapshots'][number]): MetricObservation {
  return {
    capturedAt: snapshot.capturedAt,
    views: bigIntToNumber(snapshot.views),
    likes: bigIntToNumber(snapshot.likes),
    comments: bigIntToNumber(snapshot.comments),
    shares: bigIntToNumber(snapshot.shares),
    saves: bigIntToNumber(snapshot.saves),
    followerCount: snapshot.followerCount,
    source: snapshot.source as MetricSource,
    confidence: snapshot.confidence as ConfidenceLevel,
  };
}

export function toCandidateView(row: CandidateRow, now: Date = new Date()): CandidateView {
  const observations = row.post.snapshots.map(toObservation);
  const latest = observations[observations.length - 1];
  const velocity = computeVelocity(observations, row.post.postedAt, now);

  return {
    id: row.id,
    platform: row.post.platform as Platform,
    category: row.category as ContentCategory,
    url: row.post.url,
    caption: row.post.caption,
    thumbnailUrl: row.post.thumbnailUrl,
    embedUrl: row.post.embedUrl,
    embedAllowed: row.post.embedAllowed,
    postedAt: row.post.postedAt,
    hashtags: row.post.hashtags,
    englishCommentRatio: row.post.englishCommentRatio,

    account: {
      handle: row.post.account.handle,
      displayName: row.post.account.displayName,
      profileUrl: row.post.account.profileUrl,
      followerCount: row.post.account.followerCount,
      verifiedAccount: row.post.account.verifiedAccount,
    },

    metrics: {
      views: latest?.views ?? null,
      likes: latest?.likes ?? null,
      comments: latest?.comments ?? null,
      shares: latest?.shares ?? null,
      capturedAt: latest?.capturedAt ?? null,
    },

    velocity,
    growthCurve: sevenDayCurve(observations, now),
    momentum: velocity.momentum,

    memeHook: row.memeHook,
    whyItLands: row.whyItLands,
    mascotDirection: row.mascotDirection,
    similarHistoricalMemes: row.similarHistoricalMemes,
    communityContentIdeas: row.communityContentIdeas,

    scores: {
      opportunity: row.opportunityScore,
      memeability: row.memeabilityScore,
      virality: Math.round((row.viralityScore / 25) * 10000) / 100,
      freshness: row.freshnessScore,
      pfpPotential: row.pfpPotentialScore,
      breakdown: {
        virality: row.viralityScore,
        recency: row.recencyScore,
        clarity: row.clarityScore,
        mascot: row.mascotScore,
        pfp: row.pfpScore,
        english: row.englishScore,
        originality: row.originalityScore,
        cleanScreen: row.cleanScreenScore,
        penalty: row.penaltyTotal,
      },
    },

    verificationState: row.verificationState as VerificationState,
    linkHealth: row.linkHealth as LinkHealth,
    lastVerifiedAt: row.lastVerifiedAt,
    metricSource: row.metricSource as MetricSource,
    confidence: row.confidence as ConfidenceLevel,

    screeningStatus:
      (row.concepts.find((c) => c.isPrimary)?.screeningStatus as ScreeningStatus) ?? 'UNCERTAIN',
    concepts: row.concepts.map((c) => ({
      id: c.id,
      name: c.name,
      ticker: c.ticker,
      rationale: c.rationale,
      isPrimary: c.isPrimary,
      screeningStatus: c.screeningStatus as ScreeningStatus,
      searchedQueries: c.searchedQueries,
      searchedAt: c.searchedAt,
      results: c.results.map((r) => ({
        id: r.id,
        matchType: r.matchType,
        tokenName: r.tokenName,
        tokenTicker: r.tokenTicker,
        tokenUrl: r.tokenUrl,
        mintAddress: r.mintAddress,
        marketCapUsd: r.marketCapUsd,
        athMarketCapUsd: r.athMarketCapUsd,
        createdOnIndexAt: r.createdOnIndexAt,
        holders: r.holders,
        quality: r.quality,
        source: r.source as MetricSource,
        confidence: r.confidence as ConfidenceLevel,
      })),
    })),
    risks: row.risks.map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      note: r.note,
    })),

    saved: row.savedIdeas.length > 0,
    rejected: row.rejections.length > 0,
    rejectionReason: row.rejections[0]?.reason ?? null,
  };
}

export interface FeedOptions {
  platform?: Platform;
  limit?: number;
  includeRejected?: boolean;
  savedOnly?: boolean;
  category?: ContentCategory;
  screeningStatus?: ScreeningStatus;
  minScore?: number;
}

export async function getFeed(options: FeedOptions = {}): Promise<CandidateView[]> {
  const rows = await prisma.viralCandidate.findMany({
    where: {
      excluded: false,
      ...(options.platform ? { post: { platform: options.platform } } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.minScore ? { opportunityScore: { gte: options.minScore } } : {}),
      ...(options.savedOnly ? { savedIdeas: { some: {} } } : {}),
      ...(options.includeRejected ? {} : { rejections: { none: {} } }),
    },
    include: candidateInclude,
    // Over-fetch, then apply the verified-first comparator in memory since the
    // ordering rule spans two columns with a custom precedence.
    orderBy: { opportunityScore: 'desc' },
    take: Math.max((options.limit ?? 25) * 3, 75),
  });

  const now = new Date();
  const views = rows.map((row) => toCandidateView(row, now));

  const filtered = options.screeningStatus
    ? views.filter((v) => v.screeningStatus === options.screeningStatus)
    : views;

  return filtered
    .sort((a, b) =>
      compareForRanking(
        { opportunityScore: a.scores.opportunity, verificationState: a.verificationState },
        { opportunityScore: b.scores.opportunity, verificationState: b.verificationState },
      ),
    )
    .slice(0, options.limit ?? 25);
}

export async function getCandidate(id: string): Promise<CandidateView | null> {
  const row = await prisma.viralCandidate.findUnique({
    where: { id },
    include: candidateInclude,
  });
  return row ? toCandidateView(row) : null;
}

export async function getRejectedOrOccupied(limit = 50): Promise<CandidateView[]> {
  const rows = await prisma.viralCandidate.findMany({
    where: {
      OR: [
        { rejections: { some: {} } },
        { excluded: true },
        { concepts: { some: { isPrimary: true, screeningStatus: 'OCCUPIED' } } },
      ],
    },
    include: candidateInclude,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  const now = new Date();
  return rows.map((row) => toCandidateView(row, now));
}

export async function getSavedIdeas(limit = 50): Promise<CandidateView[]> {
  const rows = await prisma.viralCandidate.findMany({
    where: { savedIdeas: { some: {} } },
    include: candidateInclude,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  const now = new Date();
  return rows.map((row) => toCandidateView(row, now));
}

/** Today's meta, derived from token-index observations already recorded. */
export async function getMeta(windowDays = 7): Promise<MetaReport> {
  const results = await prisma.tokenSearchResult.findMany({
    orderBy: { observedAt: 'desc' },
    take: 500,
    include: { concept: { select: { candidateId: true } } },
  });

  // De-duplicate by mint: the same token can match several concepts.
  const byMint = new Map<string, (typeof results)[number]>();
  for (const row of results) {
    const key = row.mintAddress ?? `${row.tokenName}:${row.tokenTicker}`;
    if (!byMint.has(key)) byMint.set(key, row);
  }

  return computeMeta(
    [...byMint.values()].map((r) => ({
      name: r.tokenName,
      ticker: r.tokenTicker,
      marketCapUsd: r.marketCapUsd,
      athMarketCapUsd: r.athMarketCapUsd,
      createdAt: r.createdOnIndexAt,
      subjectTags: [],
    })),
    { windowDays },
  );
}

export interface DashboardData {
  topOpportunities: CandidateView[];
  fastestGrowing: CandidateView[];
  newAnimals: CandidateView[];
  brainrotAndPhrases: CandidateView[];
  cleanestUntapped: CandidateView[];
  platformDistribution: Array<{ platform: Platform; count: number; averageScore: number }>;
  meta: MetaReport;
  lastScan: {
    id: string;
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    postsSeen: number;
    postsAccepted: number;
    postsRejected: number;
  } | null;
  totalCandidates: number;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [all, lastScanRow, meta] = await Promise.all([
    getFeed({ limit: 200 }),
    prisma.scanRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    getMeta(),
  ]);

  const byPlatform = new Map<Platform, { count: number; total: number }>();
  for (const candidate of all) {
    const entry = byPlatform.get(candidate.platform) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += candidate.scores.opportunity;
    byPlatform.set(candidate.platform, entry);
  }

  const ANIMAL: ContentCategory[] = ['ANIMAL', 'CAT_OR_DOG'];
  const BRAINROT: ContentCategory[] = ['BRAINROT', 'CATCHPHRASE', 'SLANG'];

  return {
    topOpportunities: all.slice(0, 12),
    fastestGrowing: [...all]
      .filter((c) => c.velocity.viewsPerHour !== null)
      .sort((a, b) => (b.velocity.viewsPerHour ?? 0) - (a.velocity.viewsPerHour ?? 0))
      .slice(0, 8),
    newAnimals: all.filter((c) => ANIMAL.includes(c.category)).slice(0, 8),
    brainrotAndPhrases: all.filter((c) => BRAINROT.includes(c.category)).slice(0, 8),
    cleanestUntapped: all
      .filter((c) => c.screeningStatus === 'CLEAN')
      .sort((a, b) => b.scores.opportunity - a.scores.opportunity)
      .slice(0, 8),
    platformDistribution: [...byPlatform.entries()].map(([platform, v]) => ({
      platform,
      count: v.count,
      averageScore: Math.round((v.total / v.count) * 10) / 10,
    })),
    meta,
    lastScan: lastScanRow
      ? {
          id: lastScanRow.id,
          startedAt: lastScanRow.startedAt,
          finishedAt: lastScanRow.finishedAt,
          status: lastScanRow.status,
          postsSeen: lastScanRow.postsSeen,
          postsAccepted: lastScanRow.postsAccepted,
          postsRejected: lastScanRow.postsRejected,
        }
      : null,
    totalCandidates: all.length,
  };
}
