import type { ReactNode } from 'react';
import type { ContentCategory, Platform, ScreeningStatus } from '@/lib/domain/types';
import { EmptyState, ErrorState, PLATFORM_STYLE } from './primitives';
import { CandidateCard } from './CandidateCard';
import { FilterBar } from './FilterBar';
import { parseFilters, type FilterState } from '@/lib/filter-state';
import { ScanButton } from './ScanButton';
import { getFeed, type CandidateView } from '@/server/queries';

/**
 * Shared radar feed used by the TikTok, Instagram, and X pages.
 *
 * The database query handles what it can express; the remaining filters (view
 * floors, window, animal/PFP toggles) are applied here against the stored
 * candidate views so the same filter set works identically on every page.
 */

const ANIMAL_CATEGORIES: ContentCategory[] = ['ANIMAL', 'CAT_OR_DOG'];

export function applyViewFilters(
  candidates: CandidateView[],
  filters: FilterState,
  now: Date = new Date(),
): CandidateView[] {
  return candidates.filter((candidate) => {
    const ageDays = (now.getTime() - new Date(candidate.postedAt).getTime()) / 86_400_000;
    if (ageDays > filters.windowDays) return false;

    if (filters.minViews > 0) {
      if (candidate.metrics.views === null) return false;
      if (candidate.metrics.views < filters.minViews) return false;
    }
    if (filters.minLikes > 0) {
      if (candidate.metrics.likes === null) return false;
      if (candidate.metrics.likes < filters.minLikes) return false;
    }
    if (filters.minFollowers > 0) {
      const followers = candidate.account.followerCount;
      if (followers === null || followers < filters.minFollowers) return false;
    }
    if (filters.catsAndDogsOnly && candidate.category !== 'CAT_OR_DOG') return false;
    if (filters.animalsOnly && !ANIMAL_CATEGORIES.includes(candidate.category)) return false;
    if (filters.pfpFriendlyOnly && candidate.scores.pfpPotential < 60) return false;
    if (filters.requireCleanPumpFun && candidate.screeningStatus !== 'CLEAN') return false;

    if (filters.requireEnglishAudience) {
      const ratio = candidate.englishCommentRatio;
      if (ratio !== null && ratio < 0.5) return false;
    }

    if (filters.noCelebrityOrIpRisk) {
      const risky = candidate.risks.some((r) =>
        ['COPYRIGHT', 'IDENTITY', 'AFFILIATION'].includes(r.kind),
      );
      if (risky) return false;
    }

    if (filters.signalStage !== 'any' && candidate.metrics.views !== null) {
      const GIGA = 25_000_000;
      if (filters.signalStage === 'early' && candidate.metrics.views > GIGA) return false;
      if (filters.signalStage === 'giga' && candidate.metrics.views < GIGA) return false;
    }

    return true;
  });
}

export async function RadarPage({
  platform,
  searchParams,
  limit = 25,
}: {
  platform: Platform;
  searchParams: Record<string, string | string[] | undefined>;
  limit?: number;
}): Promise<ReactNode> {
  const filters = parseFilters(searchParams);
  const style = PLATFORM_STYLE[platform];

  let candidates: CandidateView[];
  try {
    candidates = await getFeed({
      platform,
      limit: 200,
      category: (filters.category || undefined) as ContentCategory | undefined,
      screeningStatus: (filters.screeningStatus || undefined) as ScreeningStatus | undefined,
    });
  } catch (error) {
    return (
      <ErrorState
        title={`Could not load the ${style.label} radar`}
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  const filtered = applyViewFilters(candidates, filters).slice(0, limit);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={`text-xl font-bold tracking-tight ${style.text}`}>
            {style.label} Radar
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Top {limit} ranked ideas.{' '}
            {filtered.length < limit ? (
              <span className="text-ink-faint">
                {filtered.length} candidate{filtered.length === 1 ? '' : 's'} currently meet these
                filters — the list shows what actually qualifies rather than padding to {limit}.
              </span>
            ) : null}
          </p>
        </div>
        <ScanButton filters={{ platforms: [platform] }} label={`Rescan ${style.label}`} />
      </header>

      <FilterBar filters={filters} />

      {filtered.length === 0 ? (
        <EmptyState
          title="No candidates match these filters"
          detail={
            candidates.length === 0
              ? `No ${style.label} candidates are stored yet. Run a scan to populate the radar.`
              : `${candidates.length} stored ${style.label} candidate(s) were all filtered out. Try widening the date range or lowering the minimum view count.`
          }
          action={<ScanButton filters={{ platforms: [platform] }} />}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((candidate, index) => (
            <CandidateCard key={candidate.id} candidate={candidate} rank={index + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
