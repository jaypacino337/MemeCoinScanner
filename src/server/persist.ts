import type { Prisma, PrismaClient } from '@prisma/client';
import type { DiscoveryFilters, Platform } from '@/lib/domain/types';
import type { CandidateDraft, ScanResult } from '@/lib/pipeline/run-scan';
import { numberToBigInt } from './db';

/**
 * Persistence for a completed scan.
 *
 * Snapshots are append-only and de-duplicated by (postId, capturedAt), so
 * re-running a scan does not double-count history or overwrite an earlier
 * observation with a later one.
 */

export async function persistScanResult(
  prisma: PrismaClient,
  result: ScanResult,
  filters: DiscoveryFilters,
  trigger: string,
): Promise<{ scanRunId: string; candidateIds: string[] }> {
  const scanRun = await prisma.scanRun.create({
    data: {
      trigger,
      status: result.errors.length > 0 ? 'PARTIAL' : 'SUCCEEDED',
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      platforms: filters.platforms as Platform[],
      filters: filters as unknown as Prisma.InputJsonValue,
      postsSeen: result.stats.postsSeen,
      postsAccepted: result.stats.postsAccepted,
      postsRejected: result.stats.postsRejected,
      errorCount: result.stats.errorCount,
      notes:
        result.errors.length > 0
          ? result.errors.map((e) => `${e.platform}: ${e.message}`).join(' | ')
          : null,
    },
  });

  const candidateIds: string[] = [];

  for (const draft of result.candidates) {
    const id = await persistCandidate(prisma, draft, scanRun.id);
    candidateIds.push(id);
  }

  return { scanRunId: scanRun.id, candidateIds };
}

export async function persistCandidate(
  prisma: PrismaClient,
  draft: CandidateDraft,
  scanRunId: string | null,
): Promise<string> {
  const { discovered, score } = draft;
  const { account, post } = discovered;

  const accountRow = await prisma.socialAccount.upsert({
    where: { platform_handle: { platform: account.platform, handle: account.handle } },
    create: {
      platform: account.platform,
      handle: account.handle,
      displayName: account.displayName ?? null,
      profileUrl: account.profileUrl,
      avatarUrl: account.avatarUrl ?? null,
      followerCount: account.followerCount ?? null,
      verifiedAccount: account.verifiedAccount ?? false,
      primaryLanguage: account.primaryLanguage ?? null,
    },
    update: {
      displayName: account.displayName ?? null,
      profileUrl: account.profileUrl,
      avatarUrl: account.avatarUrl ?? null,
      followerCount: account.followerCount ?? null,
      verifiedAccount: account.verifiedAccount ?? false,
      primaryLanguage: account.primaryLanguage ?? null,
    },
  });

  const postRow = await prisma.socialPost.upsert({
    where: {
      platform_platformPostId: {
        platform: post.platform,
        platformPostId: post.platformPostId,
      },
    },
    create: {
      platform: post.platform,
      platformPostId: post.platformPostId,
      url: post.url,
      accountId: accountRow.id,
      caption: post.caption ?? null,
      thumbnailUrl: post.thumbnailUrl ?? null,
      embedUrl: post.embedUrl ?? null,
      embedAllowed: post.embedAllowed ?? false,
      postedAt: post.postedAt,
      language: post.language ?? null,
      englishCommentRatio: post.englishCommentRatio ?? null,
      hashtags: post.hashtags ?? [],
    },
    update: {
      url: post.url,
      caption: post.caption ?? null,
      thumbnailUrl: post.thumbnailUrl ?? null,
      embedUrl: post.embedUrl ?? null,
      embedAllowed: post.embedAllowed ?? false,
      englishCommentRatio: post.englishCommentRatio ?? null,
      hashtags: post.hashtags ?? [],
    },
  });

  // Append only observations we have not already stored.
  const existing = await prisma.metricSnapshot.findMany({
    where: { postId: postRow.id },
    select: { capturedAt: true },
  });
  const seen = new Set(existing.map((e) => e.capturedAt.getTime()));

  const fresh = discovered.metrics.filter((m) => !seen.has(m.capturedAt.getTime()));
  if (fresh.length > 0) {
    await prisma.metricSnapshot.createMany({
      data: fresh.map((m) => ({
        postId: postRow.id,
        capturedAt: m.capturedAt,
        views: numberToBigInt(m.views),
        likes: numberToBigInt(m.likes),
        comments: numberToBigInt(m.comments),
        shares: numberToBigInt(m.shares),
        saves: numberToBigInt(m.saves ?? null),
        followerCount: m.followerCount ?? null,
        source: m.source,
        confidence: m.confidence,
      })),
    });
  }

  // One candidate row per post: re-scans update the existing record so saved
  // ideas and rejections keep pointing at the same id.
  const existingCandidate = await prisma.viralCandidate.findFirst({
    where: { postId: postRow.id },
    orderBy: { createdAt: 'desc' },
  });

  const candidateData = {
    postId: postRow.id,
    scanRunId,
    category: discovered.signals.category,
    memeHook: discovered.signals.memeHook,
    whyItLands: discovered.signals.whyItLands,
    mascotDirection: discovered.signals.mascotDirection,
    similarHistoricalMemes: discovered.signals.similarHistoricalMemes ?? [],
    communityContentIdeas: discovered.signals.communityContentIdeas ?? [],
    viralityScore: score.components.virality,
    recencyScore: score.components.recency,
    clarityScore: score.components.clarity,
    mascotScore: score.components.mascot,
    pfpScore: score.components.pfp,
    englishScore: score.components.english,
    originalityScore: score.components.originality,
    cleanScreenScore: score.components.cleanScreen,
    penaltyTotal: score.penaltyTotal,
    opportunityScore: score.opportunityScore,
    memeabilityScore: score.memeabilityScore,
    freshnessScore: score.freshnessScore100,
    pfpPotentialScore: score.pfpPotentialScore100,
    verificationState: draft.verificationState,
    linkHealth: draft.linkHealth,
    lastVerifiedAt: draft.lastVerifiedAt,
    metricSource: draft.metricSource,
    confidence: draft.confidence,
    momentum: score.velocity.momentum,
    excluded: score.excluded,
    exclusionReason: score.exclusionReason,
  };

  const candidate = existingCandidate
    ? await prisma.viralCandidate.update({
        where: { id: existingCandidate.id },
        data: candidateData,
      })
    : await prisma.viralCandidate.create({ data: candidateData });

  // Concepts and risks are fully replaced: they are derived, not user data.
  await prisma.tokenConcept.deleteMany({ where: { candidateId: candidate.id } });
  await prisma.riskNote.deleteMany({ where: { candidateId: candidate.id } });

  for (const concept of draft.concepts) {
    const conceptRow = await prisma.tokenConcept.create({
      data: {
        candidateId: candidate.id,
        name: concept.suggestion.name,
        ticker: concept.suggestion.ticker,
        rationale: concept.suggestion.rationale,
        isPrimary: concept.isPrimary,
        screeningStatus: concept.report.status,
        searchedQueries: concept.report.queries,
        searchedAt: concept.report.searchedAt,
      },
    });

    if (concept.report.matches.length > 0) {
      await prisma.tokenSearchResult.createMany({
        data: concept.report.matches.map((match) => ({
          conceptId: conceptRow.id,
          matchType: match.matchType,
          mintAddress: match.token.mintAddress,
          tokenName: match.token.name,
          tokenTicker: match.token.ticker,
          tokenUrl: match.token.url ?? null,
          marketCapUsd: match.token.marketCapUsd,
          athMarketCapUsd: match.token.athMarketCapUsd,
          createdOnIndexAt: match.token.createdAt,
          holders: match.token.holders,
          quality: match.quality,
          source: match.token.source,
          confidence: match.token.confidence,
          observedAt: concept.report.searchedAt,
        })),
      });
    }
  }

  if (draft.risks.length > 0) {
    await prisma.riskNote.createMany({
      data: draft.risks.map((risk) => ({
        candidateId: candidate.id,
        kind: risk.kind,
        severity: risk.severity,
        note: risk.note,
      })),
    });
  }

  return candidate.id;
}

/** Records provider health so the settings page reflects the last real attempt. */
export async function recordHealth(
  prisma: PrismaClient,
  entries: Array<{
    sourceKey: string;
    state: 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'CREDENTIALS_MISSING' | 'DOWN';
    detail: string;
    checkedAt: Date;
  }>,
): Promise<void> {
  for (const entry of entries) {
    // CREDENTIALS_MISSING is a configuration state, not a fault: the provider
    // is working exactly as designed by serving labelled fixtures. Counting it
    // as a failure would light up the health page red on a clean install.
    const isFault =
      entry.state === 'DEGRADED' || entry.state === 'DOWN' || entry.state === 'RATE_LIMITED';
    const isOperating = entry.state === 'HEALTHY' || entry.state === 'CREDENTIALS_MISSING';

    await prisma.dataSourceHealth.upsert({
      where: { sourceKey: entry.sourceKey },
      create: {
        sourceKey: entry.sourceKey,
        state: entry.state,
        lastSuccessAt: isOperating ? entry.checkedAt : null,
        lastFailureAt: isFault ? entry.checkedAt : null,
        lastError: isFault ? entry.detail : null,
        consecutiveFailures: isFault ? 1 : 0,
      },
      update: {
        state: entry.state,
        ...(isFault
          ? {
              lastFailureAt: entry.checkedAt,
              lastError: entry.detail,
              consecutiveFailures: { increment: 1 },
            }
          : {
              lastSuccessAt: entry.checkedAt,
              lastError: null,
              consecutiveFailures: 0,
            }),
      },
    });
  }
}
