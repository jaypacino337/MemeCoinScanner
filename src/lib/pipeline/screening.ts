import type {
  IndexedToken,
  ScreeningStatus,
  TokenIndexResponse,
  TokenQuality,
} from '@/lib/domain/types';
import { normalizeTicker, spellingVariants } from './ticker';

/**
 * Pump.fun duplicate screening.
 *
 * Honesty rule baked into the output: we never assert that a concept has never
 * existed. `ScreeningReport.statement` always describes exactly which queries
 * ran, against which index, and at what time.
 */

/** Below this market cap a token is treated as a dust launch, not a real one. */
export const DUST_MARKET_CAP_USD = 15_000;
/** At or above this, an existing token is considered established. */
export const ESTABLISHED_MARKET_CAP_USD = 100_000;
/** ATH this high means the subject was meaningfully used even if now dead. */
export const ESTABLISHED_ATH_USD = 250_000;

export type MatchType =
  | 'EXACT_TICKER'
  | 'EXACT_NAME'
  | 'SPELLING_VARIANT'
  | 'SAME_SUBJECT'
  | 'LINKED_POST';

export interface ScreeningMatch {
  matchType: MatchType;
  token: IndexedToken;
  quality: TokenQuality;
  note: string;
}

export interface ScreeningReport {
  status: ScreeningStatus;
  matches: ScreeningMatch[];
  queries: string[];
  searchedAt: Date;
  /** Human-readable, deliberately non-absolute description of what was checked. */
  statement: string;
  indexComplete: boolean;
}

function canonical(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Classifies how real an existing token looks, from index metrics alone. */
export function classifyToken(token: IndexedToken, now: Date = new Date()): TokenQuality {
  const mcap = token.marketCapUsd;
  const ath = token.athMarketCapUsd;

  if (mcap === null && ath === null) return 'UNKNOWN';

  if ((mcap ?? 0) >= ESTABLISHED_MARKET_CAP_USD) return 'GENUINE';
  if ((ath ?? 0) >= ESTABLISHED_ATH_USD) {
    // Had real traction once. If it has collapsed and aged, call it abandoned —
    // the subject is still "used", which is what matters for our screen.
    const ageDays = token.createdAt
      ? (now.getTime() - token.createdAt.getTime()) / 86_400_000
      : null;
    if ((mcap ?? 0) < DUST_MARKET_CAP_USD && (ageDays === null || ageDays > 14)) {
      return 'ABANDONED';
    }
    return 'GENUINE';
  }
  if ((mcap ?? 0) < DUST_MARKET_CAP_USD) return 'DUST_LAUNCH';
  return 'UNKNOWN';
}

export interface ScreenInput {
  name: string;
  ticker: string;
  subject: string;
  /** Alternate spellings of the subject the provider already knows about. */
  subjectAliases?: string[];
  /** The original post URL, to catch tokens that link back to it. */
  postUrl?: string;
  response: TokenIndexResponse;
  now?: Date;
}

export function screenConcept(input: ScreenInput): ScreeningReport {
  const now = input.now ?? new Date();
  const matches: ScreeningMatch[] = [];

  const wantedTicker = normalizeTicker(input.ticker);
  const wantedName = canonical(input.name);
  const variants = new Set(spellingVariants(wantedTicker).map(canonical));
  const subjectTerms = new Set(
    [input.subject, ...(input.subjectAliases ?? [])]
      .map(canonical)
      .filter((s) => s.length >= 3),
  );

  const seen = new Set<string>();

  for (const token of input.response.tokens) {
    const tokenTicker = canonical(token.ticker);
    const tokenName = canonical(token.name);
    const quality = classifyToken(token, now);

    let matchType: MatchType | null = null;
    let note = '';

    if (tokenTicker === canonical(wantedTicker)) {
      matchType = 'EXACT_TICKER';
      note = `Ticker ${token.ticker} already exists on the index`;
    } else if (tokenName === wantedName) {
      matchType = 'EXACT_NAME';
      note = `Token name "${token.name}" already exists on the index`;
    } else if (
      input.postUrl &&
      token.linkedPostUrl &&
      canonical(token.linkedPostUrl) === canonical(input.postUrl)
    ) {
      matchType = 'LINKED_POST';
      note = `A token already links to this exact source post`;
    } else if (variants.has(tokenTicker)) {
      matchType = 'SPELLING_VARIANT';
      note = `Close spelling variant of ${wantedTicker}: ${token.ticker}`;
    } else {
      const tags = (token.subjectTags ?? []).map(canonical);
      const subjectHit =
        [...subjectTerms].some((term) => tags.includes(term)) ||
        [...subjectTerms].some(
          (term) => term.length >= 5 && (tokenName.includes(term) || term.includes(tokenName)),
        );
      if (subjectHit) {
        matchType = 'SAME_SUBJECT';
        note = `Same viral subject launched under a different ticker (${token.ticker})`;
      }
    }

    if (!matchType) continue;

    const dedupeKey = `${token.mintAddress}:${matchType}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    matches.push({ matchType, token, quality, note });
  }

  const status = deriveStatus(matches, input.response.complete);

  return {
    status,
    matches,
    queries: input.response.queries,
    searchedAt: input.response.searchedAt,
    indexComplete: input.response.complete,
    statement: buildStatement(input, matches, status),
  };
}

function deriveStatus(matches: ScreeningMatch[], indexComplete: boolean): ScreeningStatus {
  if (!indexComplete) return 'UNCERTAIN';
  if (matches.length === 0) return 'CLEAN';

  const hasEstablished = matches.some(
    (m) => m.quality === 'GENUINE' || m.quality === 'ABANDONED',
  );
  if (hasEstablished) return 'OCCUPIED';

  const allDust = matches.every((m) => m.quality === 'DUST_LAUNCH');
  if (allDust) return 'DUST_ONLY';

  // Matches exist but we cannot tell how real they are.
  return 'UNCERTAIN';
}

function buildStatement(
  input: ScreenInput,
  matches: ScreeningMatch[],
  status: ScreeningStatus,
): string {
  const when = (input.response.searchedAt ?? new Date()).toISOString();
  const queryList = input.response.queries.map((q) => `"${q}"`).join(', ');
  const scope = `Searched the token index for ${queryList} at ${when}.`;

  if (!input.response.complete) {
    return `${scope} The index did not return a complete result${
      input.response.note ? ` (${input.response.note})` : ''
    }, so duplication could not be established either way.`;
  }

  if (status === 'CLEAN') {
    return `${scope} No exact ticker, exact name, close spelling variant, or same-subject match was found in those results. This describes what these queries returned at that time — it is not a claim that no such token has ever existed.`;
  }

  const summary = matches
    .slice(0, 5)
    .map((m) => `${m.token.ticker} (${m.matchType.toLowerCase().replace(/_/g, ' ')}, ${m.quality.toLowerCase().replace(/_/g, ' ')})`)
    .join('; ');

  if (status === 'DUST_ONLY') {
    return `${scope} Found ${matches.length} match(es) — ${summary} — none showing meaningful traction at the time of the search.`;
  }
  if (status === 'OCCUPIED') {
    return `${scope} Found ${matches.length} match(es) — ${summary} — at least one of which appears established.`;
  }
  return `${scope} Found ${matches.length} match(es) — ${summary} — with insufficient market data to judge whether they are meaningful.`;
}

/**
 * Screens a primary concept and, when it is occupied, its alternates.
 * Returns the report per ticker plus which ticker should be promoted.
 */
export interface MultiScreenResult {
  reports: Map<string, ScreeningReport>;
  recommendedTicker: string;
  recommendedStatus: ScreeningStatus;
}

export async function screenWithAlternates(
  primary: { name: string; ticker: string },
  alternates: Array<{ name: string; ticker: string }>,
  subject: string,
  lookup: (query: { name: string; ticker: string; subject: string }) => Promise<TokenIndexResponse>,
  options: { postUrl?: string; subjectAliases?: string[]; now?: Date } = {},
): Promise<MultiScreenResult> {
  const reports = new Map<string, ScreeningReport>();

  const screenOne = async (candidate: { name: string; ticker: string }): Promise<ScreeningReport> => {
    const response = await lookup({
      name: candidate.name,
      ticker: candidate.ticker,
      subject,
    });
    return screenConcept({
      name: candidate.name,
      ticker: candidate.ticker,
      subject,
      subjectAliases: options.subjectAliases,
      postUrl: options.postUrl,
      response,
      now: options.now,
    });
  };

  const primaryReport = await screenOne(primary);
  reports.set(primary.ticker, primaryReport);

  let recommendedTicker = primary.ticker;
  let recommendedStatus = primaryReport.status;

  // Alternates are always screened so the detail page can show them, but the
  // recommendation only moves when the primary is genuinely occupied.
  for (const alternate of alternates) {
    if (reports.has(alternate.ticker)) continue;
    const report = await screenOne(alternate);
    reports.set(alternate.ticker, report);

    if (primaryReport.status === 'OCCUPIED' && recommendedTicker === primary.ticker) {
      if (report.status === 'CLEAN' || report.status === 'DUST_ONLY') {
        recommendedTicker = alternate.ticker;
        recommendedStatus = report.status;
      }
    }
  }

  return { reports, recommendedTicker, recommendedStatus };
}
