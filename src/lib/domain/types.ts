/**
 * Shared domain types.
 *
 * These mirror the Prisma enums but are declared independently so the pure
 * logic modules (scoring, screening, ticker generation, link validation) can be
 * unit-tested without a database or a generated client.
 */

export const PLATFORMS = ['TIKTOK', 'INSTAGRAM', 'X'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const METRIC_SOURCES = [
  'OFFICIAL_API',
  'PUBLIC_PAGE',
  'THIRD_PARTY_AGGREGATOR',
  'SYNTHETIC_FIXTURE',
  'ESTIMATED',
] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNVERIFIED';

export type LinkHealth =
  | 'OK'
  | 'REDIRECTED'
  | 'UNREACHABLE'
  | 'NOT_ORIGINAL'
  | 'ACCOUNT_MISMATCH'
  | 'ACCESS_RESTRICTED'
  | 'UNCHECKED';

export type VerificationState = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'REJECTED';

export const CONTENT_CATEGORIES = [
  'ANIMAL',
  'CAT_OR_DOG',
  'CHARACTER',
  'VISUAL_JOKE',
  'CATCHPHRASE',
  'SLANG',
  'BRAINROT',
  'SPORTS_REACTION',
  'AI_MEME',
  'NEWS_MOMENT',
  'TRANSFORMATION',
  'CHALLENGE',
  'DANCE',
  'FOOD',
  'OTHER',
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export type ScreeningStatus = 'CLEAN' | 'DUST_ONLY' | 'OCCUPIED' | 'UNCERTAIN';
export type TokenQuality = 'GENUINE' | 'ABANDONED' | 'DUST_LAUNCH' | 'UNKNOWN';
export type MomentumTrend = 'ACCELERATING' | 'STEADY' | 'DECAYING' | 'UNKNOWN';

export type RiskKind =
  | 'COPYRIGHT'
  | 'IDENTITY'
  | 'AFFILIATION'
  | 'TRAGEDY'
  | 'POLITICS'
  | 'WEAK_SOURCING'
  | 'SPONSORED'
  | 'MINOR_SUBJECT'
  | 'ADULT_CONTENT';

export type RiskSeverity = 'INFO' | 'FLAG' | 'EXCLUDE';

export interface RiskNoteInput {
  kind: RiskKind;
  severity: RiskSeverity;
  note: string;
}

/** A single observation of a post's public counters. */
export interface MetricObservation {
  capturedAt: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves?: number | null;
  followerCount?: number | null;
  source: MetricSource;
  confidence: ConfidenceLevel;
}

export interface AccountInput {
  platform: Platform;
  handle: string;
  displayName?: string | null;
  profileUrl: string;
  avatarUrl?: string | null;
  followerCount?: number | null;
  verifiedAccount?: boolean;
  primaryLanguage?: string | null;
}

export interface PostInput {
  platform: Platform;
  platformPostId: string;
  url: string;
  caption?: string | null;
  thumbnailUrl?: string | null;
  embedUrl?: string | null;
  embedAllowed?: boolean;
  postedAt: Date;
  language?: string | null;
  englishCommentRatio?: number | null;
  hashtags?: string[];
}

/** What a platform provider returns for one discovered post. */
export interface DiscoveredPost {
  account: AccountInput;
  post: PostInput;
  /** Historical + current observations, oldest first. */
  metrics: MetricObservation[];
  /** Editorial signals the provider (or its enrichment step) could determine. */
  signals: CreativeSignals;
}

/**
 * Qualitative signals. A provider that cannot determine one leaves it
 * undefined; scoring then treats it as unknown rather than assuming a value.
 */
export interface CreativeSignals {
  category: ContentCategory;
  /** 0..1 — how instantly the joke reads without explanation. */
  memeClarity?: number;
  /** 0..1 — presence of a single recognisable visual character/mascot. */
  characterStrength?: number;
  /** 0..1 — how well the subject crops to a square avatar. */
  pfpSuitability?: number;
  /** 0..1 — how much derivative community content the format invites. */
  expandability?: number;
  /** 0..1 — how unlike previously-tokenised subjects this is. */
  originality?: number;
  /** True when the format is a re-run of an older trend with no new spike. */
  isStaleTrendRevival?: boolean;
  /** Provider-declared sponsorship disclosure or #ad detection. */
  sponsored?: boolean;
  subject: string;
  memeHook: string;
  whyItLands: string;
  mascotDirection: string;
  similarHistoricalMemes?: string[];
  communityContentIdeas?: string[];
  risks?: RiskNoteInput[];
  /** Names/tickers already publicly attached to this subject, if the provider knows any. */
  knownAliases?: string[];
}

/** User-controllable discovery filters. */
export interface DiscoveryFilters {
  platforms: Platform[];
  /** Inclusive lower bound on post age window, in days. */
  windowDays: number;
  minViews: number;
  minLikes: number;
  minFollowers: number;
  categories: ContentCategory[];
  requireEnglishAudience: boolean;
  animalsOnly: boolean;
  catsAndDogsOnly: boolean;
  pfpFriendlyOnly: boolean;
  noCelebrityOrIpRisk: boolean;
  requireCleanPumpFun: boolean;
  /** "early" biases toward rising posts; "giga" toward already-huge ones. */
  signalStage: 'any' | 'early' | 'giga';
  limit: number;
}

export const DISCOVERY_WINDOWS = {
  PRIMARY_DAYS: 7,
  EARLY_SIGNAL_DAYS: 14,
  HISTORICAL_DAYS: 90,
} as const;

export const DEFAULT_FILTERS: DiscoveryFilters = {
  platforms: [...PLATFORMS],
  windowDays: DISCOVERY_WINDOWS.PRIMARY_DAYS,
  minViews: 3_000_000,
  minLikes: 0,
  minFollowers: 0,
  categories: [],
  requireEnglishAudience: true,
  animalsOnly: false,
  catsAndDogsOnly: false,
  pfpFriendlyOnly: false,
  noCelebrityOrIpRisk: false,
  requireCleanPumpFun: false,
  signalStage: 'any',
  limit: 25,
};

/** One token in the Pump.fun-style index. */
export interface IndexedToken {
  mintAddress: string;
  name: string;
  ticker: string;
  url?: string | null;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  createdAt: Date | null;
  holders: number | null;
  /** Source post/subject the token itself claims, when the index exposes it. */
  linkedPostUrl?: string | null;
  subjectTags?: string[];
  source: MetricSource;
  confidence: ConfidenceLevel;
}

export interface TokenIndexQuery {
  name?: string;
  ticker?: string;
  subject?: string;
  postUrl?: string;
}

export interface TokenIndexResponse {
  /** The literal query strings issued, echoed back for display. */
  queries: string[];
  tokens: IndexedToken[];
  searchedAt: Date;
  /** False when the index was unreachable — drives UNCERTAIN rather than CLEAN. */
  complete: boolean;
  note?: string;
}
