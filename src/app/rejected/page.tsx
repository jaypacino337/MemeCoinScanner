import type { ReactNode } from 'react';
import { CandidateCard } from '@/components/CandidateCard';
import { ErrorState, Panel } from '@/components/primitives';
import { getRejectedOrOccupied, type CandidateView } from '@/server/queries';

export const dynamic = 'force-dynamic';

export default async function RejectedPage(): Promise<ReactNode> {
  let candidates: CandidateView[];
  try {
    candidates = await getRejectedOrOccupied();
  } catch (error) {
    return (
      <ErrorState
        title="Could not load rejected ideas"
        detail={error instanceof Error ? error.message : 'Unknown error'}
      />
    );
  }

  const userRejected = candidates.filter((c) => c.rejected);
  const occupied = candidates.filter((c) => !c.rejected && c.screeningStatus === 'OCCUPIED');
  const systemExcluded = candidates.filter((c) => !c.rejected && c.screeningStatus !== 'OCCUPIED');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink">Rejected &amp; occupied</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ideas set aside by you, blocked by an existing token, or excluded by the pipeline. Kept
          visible so a rejection is auditable rather than silent.
        </p>
      </header>

      <Panel title="Rejected by you" subtitle={`${userRejected.length} idea(s)`}>
        <Group candidates={userRejected} empty="You have not rejected any ideas yet." showReason />
      </Panel>

      <Panel title="Ticker or subject occupied" subtitle={`${occupied.length} idea(s)`}>
        <Group
          candidates={occupied}
          empty="No candidate is currently blocked by an established token."
        />
      </Panel>

      <Panel title="Excluded by the pipeline" subtitle={`${systemExcluded.length} idea(s)`}>
        <Group
          candidates={systemExcluded}
          empty="Nothing has been excluded by scoring rules in the stored set."
        />
      </Panel>
    </div>
  );
}

function Group({
  candidates,
  empty,
  showReason = false,
}: {
  candidates: CandidateView[];
  empty: string;
  showReason?: boolean;
}): ReactNode {
  if (candidates.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }
  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <div key={candidate.id}>
          {showReason && candidate.rejectionReason ? (
            <p className="mb-1 text-[11px] text-caution">
              Reason: {candidate.rejectionReason}
            </p>
          ) : null}
          <CandidateCard candidate={candidate} />
        </div>
      ))}
    </div>
  );
}
