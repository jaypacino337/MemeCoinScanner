import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { GrowthChart } from '@/components/GrowthChart';
import { IdeaActions } from '@/components/IdeaActions';
import {
  ExternalLink,
  MomentumTag,
  Panel,
  PlatformTag,
  ScoreBadge,
  ScreeningPill,
  SourceTag,
  StatTile,
  VerificationBadge,
} from '@/components/primitives';
import {
  formatCount,
  formatDate,
  formatExact,
  formatPercent,
  formatRate,
  formatUsd,
  relativeTime,
  titleCase,
} from '@/lib/format';
import { SCORE_WEIGHTS } from '@/lib/pipeline/scoring';
import { getCandidate, type CandidateView, type ConceptView } from '@/server/queries';

export const dynamic = 'force-dynamic';

export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  const primary = candidate.concepts.find((c) => c.isPrimary) ?? candidate.concepts[0];
  const alternates = candidate.concepts.filter((c) => !c.isPrimary);

  return (
    <div className="space-y-6">
      <Header candidate={candidate} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MediaPreview candidate={candidate} />

          <Panel title="Viral metrics" subtitle={`Last observation ${formatDate(candidate.metrics.capturedAt)}`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Views" value={formatExact(candidate.metrics.views)} />
              <StatTile label="Likes" value={formatExact(candidate.metrics.likes)} />
              <StatTile label="Comments" value={formatExact(candidate.metrics.comments)} />
              <StatTile label="Shares / reposts" value={formatExact(candidate.metrics.shares)} />
              <StatTile
                label="View velocity"
                value={formatRate(candidate.velocity.viewsPerHour)}
                hint={
                  candidate.velocity.viewsPerHour === null
                    ? 'Needs two snapshots'
                    : 'Between the two most recent snapshots'
                }
              />
              <StatTile
                label="Lifetime rate"
                value={formatRate(candidate.velocity.lifetimeViewsPerHour)}
                hint="Views ÷ hours since posting"
              />
              <StatTile
                label="Engagement rate"
                value={formatPercent(candidate.velocity.engagementRate)}
                hint="(likes + comments + shares) ÷ views"
              />
              <StatTile
                label="Acceleration"
                value={
                  candidate.velocity.engagementAcceleration === null
                    ? '—'
                    : `${candidate.velocity.engagementAcceleration >= 0 ? '+' : ''}${formatCount(
                        candidate.velocity.engagementAcceleration,
                      )}/hr²`
                }
                hint={
                  candidate.velocity.engagementAcceleration === null
                    ? 'Needs three snapshots'
                    : 'Change in views/hour'
                }
                tone={
                  candidate.velocity.engagementAcceleration === null
                    ? 'default'
                    : candidate.velocity.engagementAcceleration > 0
                      ? 'good'
                      : 'bad'
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MomentumTag momentum={candidate.momentum} />
              <SourceTag source={candidate.metricSource} confidence={candidate.confidence} />
              <span className="text-[11px] text-ink-faint">
                {candidate.velocity.snapshotCount} snapshot
                {candidate.velocity.snapshotCount === 1 ? '' : 's'} stored
              </span>
            </div>
          </Panel>

          <Panel title="Seven-day growth" subtitle="Observed snapshots only">
            <GrowthChart points={candidate.growthCurve} />
          </Panel>

          <Panel title="Meme thesis">
            <dl className="space-y-4">
              <Definition term="One-sentence hook" value={candidate.memeHook} />
              <Definition term="Why the joke is immediately understandable" value={candidate.whyItLands} />
              <Definition term="Mascot / character direction" value={candidate.mascotDirection} />
              {candidate.similarHistoricalMemes.length > 0 ? (
                <div>
                  <dt className="text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                    Similar historical memes
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {candidate.similarHistoricalMemes.map((meme) => (
                      <span
                        key={meme}
                        className="rounded border border-hairline-strong bg-panel px-2 py-0.5 text-[11px] text-ink-muted"
                      >
                        {meme}
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
              {candidate.communityContentIdeas.length > 0 ? (
                <div>
                  <dt className="text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                    Community-content possibilities
                  </dt>
                  <dd className="mt-1">
                    <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
                      {candidate.communityContentIdeas.map((idea) => (
                        <li key={idea}>{idea}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel
            title="Pump.fun duplicate screening"
            subtitle="What was searched, and when"
          >
            {primary ? <ConceptBlock concept={primary} isPrimary /> : null}
            {alternates.length > 0 ? (
              <div className="mt-5 border-t border-hairline pt-4">
                <h3 className="mb-3 text-xs font-semibold tracking-wide text-ink uppercase">
                  Three alternate names &amp; tickers
                </h3>
                <div className="space-y-4">
                  {alternates.map((concept) => (
                    <ConceptBlock key={concept.id} concept={concept} />
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Actions">
            <IdeaActions
              candidateId={candidate.id}
              originalUrl={candidate.url}
              initiallySaved={candidate.saved}
              initiallyRejected={candidate.rejected}
            />
          </Panel>

          <Panel title="Score breakdown" subtitle={`${candidate.scores.opportunity} / 100`}>
            <ul className="space-y-2">
              <ScoreRow
                label="Verified virality"
                value={candidate.scores.breakdown.virality}
                max={SCORE_WEIGHTS.virality}
              />
              <ScoreRow
                label="Recency & velocity"
                value={candidate.scores.breakdown.recency}
                max={SCORE_WEIGHTS.recency}
              />
              <ScoreRow
                label="Meme clarity"
                value={candidate.scores.breakdown.clarity}
                max={SCORE_WEIGHTS.clarity}
              />
              <ScoreRow
                label="Visual / mascot"
                value={candidate.scores.breakdown.mascot}
                max={SCORE_WEIGHTS.mascot}
              />
              <ScoreRow
                label="PFP & expandability"
                value={candidate.scores.breakdown.pfp}
                max={SCORE_WEIGHTS.pfp}
              />
              <ScoreRow
                label="English engagement"
                value={candidate.scores.breakdown.english}
                max={SCORE_WEIGHTS.english}
              />
              <ScoreRow
                label="Originality"
                value={candidate.scores.breakdown.originality}
                max={SCORE_WEIGHTS.originality}
              />
              <ScoreRow
                label="Clean Pump.fun search"
                value={candidate.scores.breakdown.cleanScreen}
                max={SCORE_WEIGHTS.cleanScreen}
              />
            </ul>
            {candidate.scores.breakdown.penalty > 0 ? (
              <p className="mt-3 border-t border-hairline pt-3 font-mono text-xs text-occupied">
                Penalties applied: −{candidate.scores.breakdown.penalty}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatTile label="Memeability" value={String(Math.round(candidate.scores.memeability))} />
              <StatTile label="Virality" value={String(Math.round(candidate.scores.virality))} />
              <StatTile label="Freshness" value={String(Math.round(candidate.scores.freshness))} />
              <StatTile label="PFP potential" value={String(Math.round(candidate.scores.pfpPotential))} />
            </div>
          </Panel>

          <Panel title="Account">
            <dl className="space-y-2 text-sm">
              <Row label="Handle">
                <ExternalLink href={candidate.account.profileUrl}>
                  @{candidate.account.handle}
                </ExternalLink>
              </Row>
              <Row label="Display name">{candidate.account.displayName ?? '—'}</Row>
              <Row label="Followers">{formatExact(candidate.account.followerCount)}</Row>
              <Row label="Platform-verified">{candidate.account.verifiedAccount ? 'Yes' : 'No'}</Row>
              <Row label="Posted">{formatDate(candidate.postedAt)}</Row>
              <Row label="English comment share">
                {formatPercent(candidate.englishCommentRatio)}
              </Row>
            </dl>
            {candidate.caption ? (
              <div className="mt-4 border-t border-hairline pt-3">
                <p className="text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                  Original caption
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{candidate.caption}</p>
              </div>
            ) : null}
            {candidate.hashtags.length > 0 ? (
              <p className="mt-2 flex flex-wrap gap-1.5">
                {candidate.hashtags.map((tag) => (
                  <span key={tag} className="text-[11px] text-accent">
                    #{tag}
                  </span>
                ))}
              </p>
            ) : null}
          </Panel>

          <Panel title="Data integrity">
            <dl className="space-y-2 text-sm">
              <Row label="Source URL">
                <ExternalLink href={candidate.url} className="break-all">
                  {candidate.url}
                </ExternalLink>
              </Row>
              <Row label="Link health">{titleCase(candidate.linkHealth)}</Row>
              <Row label="Verification">
                <VerificationBadge
                  state={candidate.verificationState}
                  linkHealth={candidate.linkHealth}
                  lastVerifiedAt={candidate.lastVerifiedAt}
                />
              </Row>
              <Row label="Last verified">
                {candidate.lastVerifiedAt ? formatDate(candidate.lastVerifiedAt) : 'Never'}
              </Row>
              <Row label="Metric source">{titleCase(candidate.metricSource)}</Row>
              <Row label="Confidence">{titleCase(candidate.confidence)}</Row>
            </dl>
          </Panel>

          <Panel title="Risks">
            {candidate.risks.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No copyright, identity, affiliation, tragedy, politics, or sourcing risks were
                flagged by the pipeline. Automated checks are keyword-based and are not a legal
                review.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidate.risks.map((risk) => (
                  <li
                    key={risk.id}
                    className={`rounded border px-3 py-2 ${
                      risk.severity === 'EXCLUDE'
                        ? 'border-occupied/40 bg-occupied/5'
                        : risk.severity === 'FLAG'
                          ? 'border-caution/40 bg-caution/5'
                          : 'border-hairline bg-panel'
                    }`}
                  >
                    <p
                      className={`text-[10px] font-semibold tracking-wider uppercase ${
                        risk.severity === 'EXCLUDE'
                          ? 'text-occupied'
                          : risk.severity === 'FLAG'
                            ? 'text-caution'
                            : 'text-ink-faint'
                      }`}
                    >
                      {titleCase(risk.kind)} · {titleCase(risk.severity)}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{risk.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Header({ candidate }: { candidate: CandidateView }): ReactNode {
  const primary = candidate.concepts.find((c) => c.isPrimary) ?? candidate.concepts[0];
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PlatformTag platform={candidate.platform} />
          <span className="text-[11px] text-ink-faint">{titleCase(candidate.category)}</span>
          <span className="text-[11px] text-ink-faint">·</span>
          <span className="text-[11px] text-ink-faint">{relativeTime(candidate.postedAt)}</span>
          {primary ? <ScreeningPill status={primary.screeningStatus} /> : null}
          <VerificationBadge
            state={candidate.verificationState}
            linkHealth={candidate.linkHealth}
            lastVerifiedAt={candidate.lastVerifiedAt}
          />
        </div>
        <h1 className="mt-2 text-xl leading-snug font-bold tracking-tight text-ink">
          {candidate.memeHook}
        </h1>
        {primary ? (
          <p className="mt-1 font-mono text-sm text-ink-muted">
            {primary.name}{' '}
            <span className="rounded bg-panel-raised px-1.5 py-0.5 text-accent">
              ${primary.ticker}
            </span>
          </p>
        ) : null}
      </div>
      <ScoreBadge score={candidate.scores.opportunity} size="lg" />
    </header>
  );
}

function MediaPreview({ candidate }: { candidate: CandidateView }): ReactNode {
  return (
    <Panel title="Media preview">
      {candidate.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={candidate.thumbnailUrl}
          alt={`Preview of the post by @${candidate.account.handle}`}
          className="max-h-[420px] w-full rounded border border-hairline object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-hairline-strong bg-panel/40 px-4 py-12 text-center">
          <p className="text-sm font-medium text-ink">No preview available</p>
          <p className="max-w-md text-xs text-ink-muted">
            {candidate.embedAllowed
              ? 'This platform permits embedding for this post, but no thumbnail has been fetched. Nothing is substituted in its place.'
              : 'Embedding or thumbnail hotlinking is not permitted for this post, so no preview is shown.'}
          </p>
          <ExternalLink href={candidate.url} className="text-xs">
            View it on {candidate.platform.toLowerCase()} ↗
          </ExternalLink>
        </div>
      )}
    </Panel>
  );
}

function ConceptBlock({
  concept,
  isPrimary = false,
}: {
  concept: ConceptView;
  isPrimary?: boolean;
}): ReactNode {
  return (
    <div className={isPrimary ? '' : 'rounded border border-hairline bg-panel/50 p-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{concept.name}</span>
        <span className="rounded bg-panel-raised px-1.5 py-0.5 font-mono text-xs text-accent">
          ${concept.ticker}
        </span>
        <ScreeningPill status={concept.screeningStatus} compact />
        {isPrimary ? (
          <span className="text-[10px] tracking-wider text-ink-faint uppercase">primary</span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-ink-muted">{concept.rationale}</p>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Searched: {concept.searchedQueries.map((q) => `"${q}"`).join(', ') || 'no queries recorded'}
        {concept.searchedAt ? ` at ${formatDate(concept.searchedAt)}` : ''}. This states what these
        queries returned at that time; it is not a claim that no such token has ever existed.
      </p>

      {concept.results.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-[10px] tracking-wider text-ink-faint uppercase">
                <th className="py-1.5 pr-3 font-medium">Match</th>
                <th className="py-1.5 pr-3 font-medium">Token</th>
                <th className="py-1.5 pr-3 font-medium">Market cap</th>
                <th className="py-1.5 pr-3 font-medium">ATH</th>
                <th className="py-1.5 pr-3 font-medium">Created</th>
                <th className="py-1.5 font-medium">Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {concept.results.map((result) => (
                <tr key={result.id}>
                  <td className="py-1.5 pr-3 text-ink-faint">
                    {titleCase(result.matchType)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {result.tokenUrl ? (
                      <ExternalLink href={result.tokenUrl}>
                        {result.tokenName} (${result.tokenTicker})
                      </ExternalLink>
                    ) : (
                      <span className="text-ink">
                        {result.tokenName} (${result.tokenTicker})
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink tnum">
                    {formatUsd(result.marketCapUsd)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink-muted tnum">
                    {formatUsd(result.athMarketCapUsd)}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-muted">
                    {result.createdOnIndexAt ? relativeTime(result.createdOnIndexAt) : '—'}
                  </td>
                  <td className="py-1.5 text-ink-muted">{titleCase(result.quality)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">
          No exact ticker, exact name, close spelling variant, same-subject, or linked-post match
          appeared in those results.
        </p>
      )}
    </div>
  );
}

function ScoreRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}): ReactNode {
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="font-mono text-ink tnum">
          {value.toFixed(1)}
          <span className="text-ink-faint">/{max}</span>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(share * 100, 1)}%` }}
        />
      </div>
    </li>
  );
}

function Definition({ term, value }: { term: string; value: string }): ReactNode {
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wider text-ink-faint uppercase">{term}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{value || '—'}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right text-xs text-ink">{children}</dd>
    </div>
  );
}
