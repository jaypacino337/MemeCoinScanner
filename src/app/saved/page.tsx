import type { ReactNode } from 'react';
import { CandidateCard } from '@/components/CandidateCard';
import { EmptyState, ErrorState } from '@/components/primitives';
import { getSavedIdeas, type CandidateView } from '@/server/queries';

export const dynamic = 'force-dynamic';

export default async function SavedPage(): Promise<ReactNode> {
  let candidates: CandidateView[];
  try {
    candidates = await getSavedIdeas();
  } catch (error) {
    return (
      <ErrorState
        title="Could not load saved ideas"
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink">Saved ideas</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {candidates.length} idea{candidates.length === 1 ? '' : 's'} kept for review.
        </p>
      </header>

      {candidates.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          detail="Open any idea and use “Save idea” to keep it here. Saving clears a previous rejection on the same idea."
        />
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate, index) => (
            <CandidateCard key={candidate.id} candidate={candidate} rank={index + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
