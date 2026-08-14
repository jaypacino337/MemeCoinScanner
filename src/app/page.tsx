import Link from 'next/link';
import type { ReactNode } from 'react';
import { CandidateCard } from '@/components/CandidateCard';
import { EmptyState, ErrorState, Panel, PLATFORM_STYLE, StatTile } from '@/components/primitives';
import { ScanButton } from '@/components/ScanButton';
import { formatDate, relativeTime } from '@/lib/format';
import { getDashboardData, type CandidateView, type DashboardData } from '@/server/queries';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactNode> {
  let data: DashboardData;
  try {
    data = await getDashboardData();
  } catch (error) {
    return (
      <ErrorState
        title="Could not load the dashboard"
        detail={
          error instanceof Error
            ? `${error.message}. Check DATABASE_URL and that migrations have been applied.`
            : 'Unknown error'
        }
      />
    );
  }

  if (data.totalCandidates === 0) {
    return (
      <div className="space-y-6">
        <Header lastScan={data.lastScan} total={0} />
        <EmptyState
          title="No candidates yet"
          detail="Run a scan to populate the radar. In demo mode this uses the bundled synthetic fixtures; with credentials configured it queries your configured providers."
          action={<ScanButton />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header lastScan={data.lastScan} total={data.totalCandidates} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Candidates tracked" value={String(data.totalCandidates)} />
        <StatTile
          label="Clean concepts"
          value={String(data.cleanestUntapped.length)}
          hint="No meaningful token match found"
          tone="good"
        />
        <StatTile
          label="Accelerating"
          value={String(
            data.topOpportunities.filter((c) => c.momentum === 'ACCELERATING').length,
          )}
          hint="Velocity rising between snapshots"
        />
        <StatTile
          label="Last scan"
          value={data.lastScan ? relativeTime(data.lastScan.startedAt) : '—'}
          hint={data.lastScan ? `${data.lastScan.postsAccepted} accepted` : 'Never run'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title="Top opportunities"
            subtitle="Ranked by the 100-point model. Verified results always rank above unverified ones."
            action={<ScanButton />}
          >
            <div className="space-y-3">
              {data.topOpportunities.map((candidate, index) => (
                <CandidateCard key={candidate.id} candidate={candidate} rank={index + 1} />
              ))}
            </div>
          </Panel>

          <Panel
            title="Fastest-growing posts"
            subtitle="Highest views-per-hour between the two most recent snapshots."
          >
            <CompactList
              candidates={data.fastestGrowing}
              empty="No post has two snapshots yet, so no growth rate can be computed."
            />
          </Panel>

          <div className="grid gap-6 md:grid-cols-2">
            <Panel title="New animals" subtitle="Animal and pet subjects">
              <CompactList
                candidates={data.newAnimals}
                empty="No animal candidates in the current set."
              />
            </Panel>
            <Panel title="Brainrot & phrases" subtitle="Catchphrases, slang, brainrot formats">
              <CompactList
                candidates={data.brainrotAndPhrases}
                empty="No catchphrase or brainrot candidates in the current set."
              />
            </Panel>
          </div>
        </div>

        <div className="space-y-6">
          <TodaysMeta meta={data.meta} />

          <Panel
            title="Cleanest untapped"
            subtitle="Screened CLEAN against the token index"
          >
            <CompactList
              candidates={data.cleanestUntapped}
              empty="Nothing screened CLEAN in the current set."
            />
          </Panel>

          <Panel title="Platform distribution">
            {data.platformDistribution.length === 0 ? (
              <p className="text-sm text-ink-muted">No data.</p>
            ) : (
              <ul className="space-y-3">
                {data.platformDistribution.map((row) => {
                  const share = row.count / data.totalCandidates;
                  const style = PLATFORM_STYLE[row.platform];
                  return (
                    <li key={row.platform}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className={`font-medium ${style.text}`}>{style.label}</span>
                        <span className="font-mono text-ink-muted tnum">
                          {row.count} · avg {row.averageScore}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel">
                        <div
                          className={`h-full rounded-full ${style.dot}`}
                          style={{ width: `${Math.max(share * 100, 2)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Header({
  lastScan,
  total,
}: {
  lastScan: DashboardData['lastScan'];
  total: number;
}): ReactNode {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {total > 0
            ? `${total} candidates in the current window.`
            : 'No candidates yet.'}{' '}
          {lastScan
            ? `Last scan ${formatDate(lastScan.startedAt)} — ${lastScan.postsSeen} seen, ${lastScan.postsAccepted} accepted, ${lastScan.postsRejected} rejected.`
            : ''}
        </p>
      </div>
    </header>
  );
}

function CompactList({
  candidates,
  empty,
}: {
  candidates: CandidateView[];
  empty: string;
}): ReactNode {
  if (candidates.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-hairline">
      {candidates.map((candidate) => {
        const style = PLATFORM_STYLE[candidate.platform];
        return (
          <li key={candidate.id} className="py-2 first:pt-0 last:pb-0">
            <Link href={`/idea/${candidate.id}`} className="group flex items-start gap-3">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink group-hover:text-accent">
                  {candidate.memeHook}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">
                  @{candidate.account.handle} · {relativeTime(candidate.postedAt)}
                </span>
              </span>
              <span className="font-mono text-xs font-semibold text-ink-muted tnum">
                {Math.round(candidate.scores.opportunity)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TodaysMeta({ meta }: { meta: DashboardData['meta'] }): ReactNode {
  return (
    <Panel
      title="Today's meta"
      subtitle={`Patterns across launches observed in the last ${meta.windowDays} days`}
    >
      {!meta.meaningful ? (
        <p className="text-sm text-ink-muted">
          Not enough launch data has been observed yet to describe a pattern. This section stays
          empty rather than showing a guess.
        </p>
      ) : (
        <ul className="space-y-3">
          {meta.patterns.map((pattern) => (
            <li key={pattern.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-ink">{pattern.label}</span>
                <span className="font-mono text-[11px] text-ink-muted tnum">
                  {Math.round(pattern.share * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(pattern.share * 100, 2)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-faint">{pattern.detail}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
        {meta.caveat}
      </p>
    </Panel>
  );
}
