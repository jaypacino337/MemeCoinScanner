import type {
  ConfidenceLevel,
  DiscoveredPost,
  DiscoveryFilters,
  LinkHealth,
  MetricSource,
  Platform,
  RiskNoteInput,
  ScreeningStatus,
  VerificationState,
} from '@/lib/domain/types';
import { childLogger } from '@/lib/infra/logger';
import type { PlatformProvider, TokenIndexProvider } from '@/lib/providers/types';
import { applyFilters, deriveRisks } from './filters';
import { deriveVerificationState, verifyPostUrl, type VerifyOptions } from './linkcheck';
import { scoreCandidate, type ScoreResult } from './scoring';
import { screenWithAlternates, type ScreeningReport } from './screening';
import { buildSuggestions, type TokenSuggestion } from './ticker';
import { latestObservation } from './velocity';

/**
 * The scan pipeline.
 *
 * Pure with respect to storage: it takes providers in and returns drafts out,
 * so the whole flow is testable without a database. Persistence is a separate
 * concern (see src/server/persist.ts).
 *
 * Stage order matters and is deliberate:
 *   discover -> threshold filter -> link verification -> duplicate screening
 *   -> scoring -> ranking
 * Filtering before verification avoids spending network budget on posts the
 * user already excluded; screening before scoring is required because the
 * screening result feeds the 5-point clean-screen component.
 */

export interface ConceptDraft {
  suggestion: TokenSuggestion;
  isPrimary: boolean;
  report: ScreeningReport;
}

export interface CandidateDraft {
  discovered: DiscoveredPost;
  score: ScoreResult;
  risks: RiskNoteInput[];
  concepts: ConceptDraft[];
  screeningStatus: ScreeningStatus;
  recommendedTicker: string;
  verificationState: VerificationState;
  linkHealth: LinkHealth;
  lastVerifiedAt: Date | null;
  verificationNote: string | null;
  metricSource: MetricSource;
  confidence: ConfidenceLevel;
}

export interface RejectedDraft {
  platform: Platform;
  url: string;
  handle: string;
  subject: string;
  reason: string;
  stage: 'filter' | 'verification' | 'scoring';
}

export interface ScanStats {
  postsSeen: number;
  postsAccepted: number;
  postsRejected: number;
  errorCount: number;
  perPlatform: Record<string, { seen: number; accepted: number; rejected: number }>;
}

export interface ScanResult {
  candidates: CandidateDraft[];
  rejected: RejectedDraft[];
  stats: ScanStats;
  errors: Array<{ platform: Platform; message: string }>;
  startedAt: Date;
  finishedAt: Date;
}

export interface RunScanDeps {
  providers: Map<Platform, PlatformProvider>;
  tokenIndex: TokenIndexProvider;
  filters: DiscoveryFilters;
  now?: () => Date;
  /** Passed through to link verification; set performNetworkCheck false offline. */
  verifyOptions?: VerifyOptions;
}

function metricsAreTrusted(source: MetricSource, confidence: ConfidenceLevel): boolean {
  return (
    (source === 'OFFICIAL_API' || source === 'PUBLIC_PAGE') &&
    (confidence === 'HIGH' || confidence === 'MEDIUM')
  );
}

export async function runScan(deps: RunScanDeps): Promise<ScanResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const log = childLogger({ stage: 'scan' });

  const candidates: CandidateDraft[] = [];
  const rejected: RejectedDraft[] = [];
  const errors: Array<{ platform: Platform; message: string }> = [];
  const perPlatform: ScanStats['perPlatform'] = {};

  let postsSeen = 0;
  let postsAccepted = 0;
  let postsRejected = 0;

  for (const platform of deps.filters.platforms) {
    const provider = deps.providers.get(platform);
    if (!provider) {
      errors.push({ platform, message: `No provider registered for ${platform}` });
      continue;
    }

    const tally = { seen: 0, accepted: 0, rejected: 0 };
    perPlatform[platform] = tally;

    let discovered: DiscoveredPost[];
    try {
      discovered = await provider.discover(deps.filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ platform, err: message }, 'discovery failed');
      errors.push({ platform, message });
      continue;
    }

    for (const item of discovered) {
      postsSeen += 1;
      tally.seen += 1;

      const risks = deriveRisks(item);

      // --- Stage 1: threshold filters -------------------------------------
      const filterOutcome = applyFilters(item, deps.filters, risks, now());
      if (!filterOutcome.passed) {
        postsRejected += 1;
        tally.rejected += 1;
        rejected.push({
          platform,
          url: item.post.url,
          handle: item.account.handle,
          subject: item.signals.subject,
          reason: filterOutcome.reason ?? 'Did not pass filters',
          stage: 'filter',
        });
        continue;
      }

      // --- Stage 2: link verification --------------------------------------
      const verification = await verifyPostUrl(item.post.url, platform, {
        ...deps.verifyOptions,
        expectedHandle: item.account.handle,
        now,
      });

      // A structurally wrong link (aggregator, search page, wrong account) is a
      // hard reject: we never substitute a working search URL for it.
      if (verification.health === 'NOT_ORIGINAL' || verification.health === 'ACCOUNT_MISMATCH') {
        postsRejected += 1;
        tally.rejected += 1;
        rejected.push({
          platform,
          url: item.post.url,
          handle: item.account.handle,
          subject: item.signals.subject,
          reason: verification.reason ?? 'Source link is not a direct original post',
          stage: 'verification',
        });
        continue;
      }

      const latest = latestObservation(item.metrics);
      const metricSource: MetricSource = latest?.source ?? 'ESTIMATED';
      const confidence: ConfidenceLevel = latest?.confidence ?? 'UNVERIFIED';
      const trusted = metricsAreTrusted(metricSource, confidence);
      const verificationState = deriveVerificationState(verification.health, trusted);

      // --- Stage 3: duplicate screening ------------------------------------
      const { primary, alternates } = buildSuggestions(
        item.signals.subject,
        item.signals.memeHook,
        3,
      );

      let screening;
      try {
        screening = await screenWithAlternates(
          primary,
          alternates,
          item.signals.subject,
          (query) => deps.tokenIndex.search(query),
          {
            postUrl: item.post.url,
            subjectAliases: item.signals.knownAliases,
            now: now(),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ platform, err: message }, 'token screening failed');
        errors.push({ platform, message });
        continue;
      }

      const primaryReport = screening.reports.get(primary.ticker);
      if (!primaryReport) {
        errors.push({ platform, message: `Screening produced no report for ${primary.ticker}` });
        continue;
      }

      const concepts: ConceptDraft[] = [
        { suggestion: primary, isPrimary: true, report: primaryReport },
        ...alternates
          .map((suggestion) => {
            const report = screening.reports.get(suggestion.ticker);
            return report ? { suggestion, isPrimary: false, report } : null;
          })
          .filter((c): c is ConceptDraft => c !== null),
      ];

      // The screening status that feeds scoring is the recommended ticker's:
      // if the primary is occupied but a clean alternate exists, the concept is
      // still workable, just under a different ticker.
      const effectiveStatus = screening.recommendedStatus;

      if (deps.filters.requireCleanPumpFun && effectiveStatus !== 'CLEAN') {
        postsRejected += 1;
        tally.rejected += 1;
        rejected.push({
          platform,
          url: item.post.url,
          handle: item.account.handle,
          subject: item.signals.subject,
          reason: `Duplicate screening returned ${effectiveStatus}`,
          stage: 'filter',
        });
        continue;
      }

      // --- Stage 4: scoring -------------------------------------------------
      const score = scoreCandidate({
        observations: item.metrics,
        postedAt: item.post.postedAt,
        signals: item.signals,
        screeningStatus: effectiveStatus,
        metricSource,
        confidence,
        englishCommentRatio: item.post.englishCommentRatio,
        postLanguage: item.post.language,
        risks,
        sourceIsDirectAndReachable:
          verification.health === 'OK' ||
          verification.health === 'REDIRECTED' ||
          // Structural check passed but the network call was skipped or blocked.
          // That is an unverified result, not a broken one.
          verification.health === 'UNCHECKED' ||
          verification.health === 'ACCESS_RESTRICTED',
        now: now(),
      });

      if (score.excluded) {
        postsRejected += 1;
        tally.rejected += 1;
        rejected.push({
          platform,
          url: item.post.url,
          handle: item.account.handle,
          subject: item.signals.subject,
          reason: `Excluded by scoring: ${score.exclusionReason}`,
          stage: 'scoring',
        });
        continue;
      }

      postsAccepted += 1;
      tally.accepted += 1;

      candidates.push({
        discovered: item,
        score,
        risks,
        concepts,
        screeningStatus: effectiveStatus,
        recommendedTicker: screening.recommendedTicker,
        verificationState,
        linkHealth: verification.health,
        lastVerifiedAt: verification.verified ? verification.checkedAt : null,
        verificationNote: verification.reason,
        metricSource,
        confidence,
      });
    }
  }

  const finishedAt = now();
  log.info(
    { postsSeen, postsAccepted, postsRejected, errors: errors.length },
    'scan complete',
  );

  return {
    candidates,
    rejected,
    stats: { postsSeen, postsAccepted, postsRejected, errorCount: errors.length, perPlatform },
    errors,
    startedAt,
    finishedAt,
  };
}
