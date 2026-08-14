import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CandidateView } from '@/server/queries';
import { formatCount, formatPercent, formatRate, relativeTime, titleCase } from '@/lib/format';
import {
  MomentumTag,
  PlatformTag,
  ScoreBadge,
  ScreeningPill,
  SourceTag,
  VerificationBadge,
} from './primitives';

/**
 * Compact, data-dense result card.
 *
 * Layout priority: rank + score first (the scan question), then the thumbnail,
 * then the meme thesis, then metrics. Verification state sits next to the
 * metrics it qualifies, not buried at the bottom.
 */

function Thumbnail({ candidate }: { candidate: CandidateView }): ReactNode {
  if (candidate.thumbnailUrl) {
    return (
      // Deliberately a plain <img>: thumbnails come from arbitrary platform
      // CDNs which are not enumerable in next.config remotePatterns.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={candidate.thumbnailUrl}
        alt={`Preview of the post by @${candidate.account.handle}`}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-panel-raised px-2 text-center">
      <span className="text-[10px] leading-tight font-medium text-ink-faint uppercase">
        No preview
      </span>
      <span className="text-[10px] leading-tight text-ink-faint">
        {candidate.embedAllowed ? 'Not fetched' : 'Embedding not permitted'}
      </span>
    </div>
  );
}

export function CandidateCard({
  candidate,
  rank,
}: {
  candidate: CandidateView;
  rank?: number;
}): ReactNode {
  const primary = candidate.concepts.find((c) => c.isPrimary) ?? candidate.concepts[0];
  const highRisk = candidate.risks.filter((r) => r.severity !== 'INFO');

  return (
    <article className="group rounded-lg border border-hairline bg-charcoal transition-colors hover:border-hairline-strong">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* Rank + score rail */}
        <div className="flex shrink-0 flex-row items-center gap-3 sm:w-14 sm:flex-col">
          {rank !== undefined ? (
            <span className="font-mono text-lg font-bold text-ink-faint tnum">
              {String(rank).padStart(2, '0')}
            </span>
          ) : null}
          <ScoreBadge score={candidate.scores.opportunity} />
        </div>

        {/* Media */}
        <Link
          href={`/idea/${candidate.id}`}
          className="h-28 w-full shrink-0 overflow-hidden rounded border border-hairline sm:h-24 sm:w-24"
          aria-label={`Open details for ${primary?.name ?? candidate.memeHook}`}
        >
          <Thumbnail candidate={candidate} />
        </Link>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformTag platform={candidate.platform} />
            <span className="text-[11px] text-ink-faint">
              {titleCase(candidate.category)}
            </span>
            <span className="text-[11px] text-ink-faint">·</span>
            <span className="text-[11px] text-ink-faint">
              {relativeTime(candidate.postedAt)}
            </span>
            {primary ? <ScreeningPill status={primary.screeningStatus} compact /> : null}
          </div>

          <h3 className="mt-2 text-sm leading-snug font-semibold text-ink">
            <Link href={`/idea/${candidate.id}`} className="hover:text-accent">
              {candidate.memeHook}
            </Link>
          </h3>

          {primary ? (
            <p className="mt-1 font-mono text-xs text-ink-muted">
              {primary.name}{' '}
              <span className="rounded bg-panel-raised px-1 py-0.5 text-accent">
                ${primary.ticker}
              </span>
            </p>
          ) : null}

          <p className="mt-2 truncate text-xs text-ink-muted">
            <a
              href={candidate.account.profileUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="hover:text-accent"
            >
              @{candidate.account.handle}
            </a>
            <span className="text-ink-faint">
              {' · '}
              {formatCount(candidate.account.followerCount)} followers
            </span>
          </p>

          {/* Metric strip */}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            <Metric label="Views" value={formatCount(candidate.metrics.views)} />
            <Metric label="Likes" value={formatCount(candidate.metrics.likes)} />
            <Metric label="Comments" value={formatCount(candidate.metrics.comments)} />
            <Metric label="Shares" value={formatCount(candidate.metrics.shares)} />
            <Metric
              label="Velocity"
              value={formatRate(
                candidate.velocity.viewsPerHour ?? candidate.velocity.lifetimeViewsPerHour,
              )}
            />
            <Metric label="Engagement" value={formatPercent(candidate.velocity.engagementRate)} />
            <Metric label="Memeability" value={`${Math.round(candidate.scores.memeability)}`} />
            <Metric label="PFP" value={`${Math.round(candidate.scores.pfpPotential)}`} />
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <VerificationBadge
              state={candidate.verificationState}
              linkHealth={candidate.linkHealth}
              lastVerifiedAt={candidate.lastVerifiedAt}
            />
            <SourceTag source={candidate.metricSource} confidence={candidate.confidence} />
            <MomentumTag momentum={candidate.momentum} />
            {highRisk.length > 0 ? (
              <span
                className="rounded border border-caution/40 bg-caution/10 px-1.5 py-0.5 text-[10px] font-medium text-caution"
                title={highRisk.map((r) => r.note).join('\n')}
              >
                {highRisk.length} risk flag{highRisk.length === 1 ? '' : 's'}
              </span>
            ) : null}
            <a
              href={candidate.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="ml-auto rounded border border-hairline-strong px-2 py-1 text-[11px] font-medium text-ink-muted hover:border-accent hover:text-accent"
            >
              Open original ↗
            </a>
            <Link
              href={`/idea/${candidate.id}`}
              className="rounded border border-hairline-strong px-2 py-1 text-[11px] font-medium text-ink-muted hover:border-accent hover:text-accent"
            >
              Details
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wider text-ink-faint uppercase">{label}</dt>
      <dd className="font-mono text-xs font-medium text-ink tnum">{value}</dd>
    </div>
  );
}
