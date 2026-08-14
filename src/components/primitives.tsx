import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  ConfidenceLevel,
  LinkHealth,
  MetricSource,
  MomentumTrend,
  Platform,
  ScreeningStatus,
  VerificationState,
} from '@/lib/domain/types';

/** Shared presentational primitives: badges, pills, panels, empty states. */

export const PLATFORM_STYLE: Record<
  Platform,
  { label: string; text: string; border: string; bg: string; dot: string }
> = {
  TIKTOK: {
    label: 'TikTok',
    text: 'text-tiktok',
    border: 'border-tiktok/40',
    bg: 'bg-tiktok/10',
    dot: 'bg-tiktok',
  },
  INSTAGRAM: {
    label: 'Instagram',
    text: 'text-instagram',
    border: 'border-instagram/40',
    bg: 'bg-instagram/10',
    dot: 'bg-instagram',
  },
  X: {
    label: 'X',
    text: 'text-x',
    border: 'border-x/30',
    bg: 'bg-x/10',
    dot: 'bg-x-alt',
  },
};

export function PlatformTag({ platform }: { platform: Platform }): ReactNode {
  const style = PLATFORM_STYLE[platform];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${style.text} ${style.border} ${style.bg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  );
}

const SCREENING_STYLE: Record<
  ScreeningStatus,
  { label: string; className: string; hint: string }
> = {
  CLEAN: {
    label: 'CLEAN',
    className: 'text-clean border-clean/40 bg-clean/10',
    hint: 'No exact or meaningful subject match in the searched results',
  },
  DUST_ONLY: {
    label: 'DUST ONLY',
    className: 'text-caution border-caution/40 bg-caution/10',
    hint: 'Matches exist but show no meaningful traction',
  },
  UNCERTAIN: {
    label: 'UNCERTAIN',
    className: 'text-caution border-caution/40 bg-caution/10',
    hint: 'Insufficient reliable information to judge duplication',
  },
  OCCUPIED: {
    label: 'OCCUPIED',
    className: 'text-occupied border-occupied/40 bg-occupied/10',
    hint: 'An established token already uses this name, ticker, or subject',
  },
};

export function ScreeningPill({
  status,
  compact = false,
}: {
  status: ScreeningStatus;
  compact?: boolean;
}): ReactNode {
  const style = SCREENING_STYLE[status];
  return (
    <span
      title={style.hint}
      className={`inline-flex items-center rounded border font-mono font-semibold tracking-wider ${style.className} ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
    >
      {style.label}
    </span>
  );
}

const VERIFICATION_STYLE: Record<VerificationState, { label: string; className: string }> = {
  VERIFIED: { label: 'Verified', className: 'text-clean border-clean/40 bg-clean/10' },
  PARTIALLY_VERIFIED: {
    label: 'Partly verified',
    className: 'text-caution border-caution/40 bg-caution/10',
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: 'text-ink-faint border-hairline-strong bg-panel-raised',
  },
  REJECTED: { label: 'Rejected', className: 'text-occupied border-occupied/40 bg-occupied/10' },
};

export function VerificationBadge({
  state,
  linkHealth,
  lastVerifiedAt,
}: {
  state: VerificationState;
  linkHealth?: LinkHealth;
  lastVerifiedAt?: Date | string | null;
}): ReactNode {
  const style = VERIFICATION_STYLE[state];
  const when = lastVerifiedAt ? new Date(lastVerifiedAt) : null;
  const title = [
    linkHealth ? `Link health: ${linkHealth}` : null,
    when ? `Last verified ${when.toISOString()}` : 'Never verified against the live post',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function ScoreBadge({
  score,
  label = 'Opportunity',
  size = 'md',
}: {
  score: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}): ReactNode {
  // Colour tracks the score band so a wall of cards is scannable at a glance.
  const tone =
    score >= 75
      ? 'text-clean border-clean/40 bg-clean/10'
      : score >= 55
        ? 'text-accent border-accent/40 bg-accent/10'
        : score >= 35
          ? 'text-caution border-caution/40 bg-caution/10'
          : 'text-ink-faint border-hairline-strong bg-panel-raised';

  const sizing =
    size === 'lg'
      ? 'text-2xl px-3 py-1.5'
      : size === 'sm'
        ? 'text-xs px-1.5 py-0.5'
        : 'text-base px-2 py-1';

  return (
    <span
      className={`inline-flex flex-col items-center rounded border font-mono font-bold tnum ${tone} ${sizing}`}
      title={`${label}: ${score} out of 100`}
    >
      {Math.round(score)}
      {size === 'lg' ? (
        <span className="text-[10px] font-normal tracking-wide uppercase opacity-70">
          / 100
        </span>
      ) : null}
    </span>
  );
}

export function MomentumTag({ momentum }: { momentum: MomentumTrend }): ReactNode {
  const map: Record<MomentumTrend, { label: string; className: string }> = {
    ACCELERATING: { label: '▲ Accelerating', className: 'text-clean' },
    STEADY: { label: '▬ Steady', className: 'text-ink-muted' },
    DECAYING: { label: '▼ Decaying', className: 'text-occupied' },
    UNKNOWN: { label: '— No trend data', className: 'text-ink-faint' },
  };
  const style = map[momentum];
  return <span className={`text-[11px] font-medium ${style.className}`}>{style.label}</span>;
}

export function SourceTag({
  source,
  confidence,
}: {
  source: MetricSource;
  confidence: ConfidenceLevel;
}): ReactNode {
  const synthetic = source === 'SYNTHETIC_FIXTURE';
  const estimated = source === 'ESTIMATED';
  const tone = synthetic
    ? 'text-caution border-caution/40 bg-caution/10'
    : estimated
      ? 'text-caution border-caution/30 bg-caution/5'
      : 'text-ink-faint border-hairline-strong bg-panel-raised';

  const label = synthetic
    ? 'DEMO DATA'
    : source.replace(/_/g, ' ').toLowerCase();

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${tone}`}
      title={`Metric source: ${source} · Confidence: ${confidence}`}
    >
      {label}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section
      className={`rounded-lg border border-hairline bg-charcoal ${className}`}
    >
      {title ? (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline-strong bg-panel/40 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-ink-muted">{detail}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: string; detail: string }): ReactNode {
  return (
    <div className="rounded-lg border border-occupied/40 bg-occupied/5 px-4 py-5">
      <p className="text-sm font-semibold text-occupied">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{detail}</p>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }): ReactNode {
  return <div className={`skeleton rounded ${className}`} aria-hidden />;
}

export function CardSkeleton(): ReactNode {
  return (
    <div className="rounded-lg border border-hairline bg-charcoal p-4">
      <div className="flex gap-4">
        <Skeleton className="h-24 w-24 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}): ReactNode {
  const toneClass =
    tone === 'good'
      ? 'text-clean'
      : tone === 'warn'
        ? 'text-caution'
        : tone === 'bad'
          ? 'text-occupied'
          : 'text-ink';
  return (
    <div className="rounded border border-hairline bg-panel px-3 py-2">
      <p className="text-[10px] font-medium tracking-wider text-ink-faint uppercase">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tnum ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`text-accent underline-offset-2 hover:underline ${className}`}
    >
      {children}
    </a>
  );
}

export function InternalLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
