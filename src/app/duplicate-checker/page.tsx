'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Panel, ScreeningPill } from '@/components/primitives';
import { formatDate, formatUsd, relativeTime, titleCase } from '@/lib/format';
import type { ScreeningStatus } from '@/lib/domain/types';

interface MatchResult {
  matchType: string;
  quality: string;
  note: string;
  token: {
    name: string;
    ticker: string;
    mintAddress: string;
    url: string | null;
    marketCapUsd: number | null;
    athMarketCapUsd: number | null;
    createdAt: string | null;
    holders: number | null;
    source: string;
    confidence: string;
  };
}

interface Report {
  name: string;
  ticker: string;
  isPrimary: boolean;
  validation: { valid: boolean; problems: string[] };
  status: ScreeningStatus;
  statement: string;
  queries: string[];
  searchedAt: string;
  indexComplete: boolean;
  matches: MatchResult[];
}

interface CheckResponse {
  subject?: string;
  indexProvider?: { name: string; mode: string };
  reports?: Report[];
  error?: string;
  detail?: string;
}

export default function DuplicateCheckerPage(): ReactNode {
  const [subject, setSubject] = useState('');
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResponse | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (subject.trim().length < 2) {
      setError('Describe the viral subject in at least two characters.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/duplicate-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          name: name.trim() || undefined,
          ticker: ticker.trim() || undefined,
          postUrl: postUrl.trim() || undefined,
          includeAlternates: true,
        }),
      });
      const body = (await response.json()) as CheckResponse;

      if (!response.ok) {
        setError(
          response.status === 429
            ? `Rate limited. ${body.detail ?? 'Try again shortly.'}`
            : `${body.error ?? 'Check failed'}${body.detail ? `: ${body.detail}` : ''}`,
        );
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink">Pump.fun duplicate checker</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Screens a name, ticker, and subject against the configured token index — exact ticker,
          exact name, close spelling variants, the same viral subject under another ticker, and
          tokens linked to the source post. Three alternates are generated and screened alongside
          it.
        </p>
      </header>

      <Panel title="Search">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              Viral subject (required)
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. commuter ferret"
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              Token name (optional)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if blank"
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              Ticker (optional, max 10 chars)
            </span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="Auto-generated if blank"
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              Source post URL (optional)
            </span>
            <input
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@handle/video/123…"
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded border border-accent/50 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {loading ? 'Searching…' : 'Screen name & ticker'}
            </button>
          </div>
        </form>

        {error ? (
          <p className="mt-3 rounded border border-occupied/40 bg-occupied/5 px-3 py-2 text-xs text-occupied">
            {error}
          </p>
        ) : null}
      </Panel>

      {loading ? (
        <Panel title="Results">
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton h-24 rounded" />
            ))}
          </div>
        </Panel>
      ) : null}

      {result?.reports ? (
        <Panel
          title="Results"
          subtitle={
            result.indexProvider
              ? `Index: ${result.indexProvider.name} (${result.indexProvider.mode} mode)`
              : undefined
          }
        >
          {result.indexProvider?.mode === 'fixture' ? (
            <p className="mb-4 rounded border border-caution/40 bg-caution/5 px-3 py-2 text-xs text-caution">
              These results come from the bundled synthetic demo index, not the live Pump.fun
              index. Configure PUMPFUN_API_BASE_URL to screen against real data.
            </p>
          ) : null}

          <div className="space-y-4">
            {result.reports.map((report) => (
              <ReportBlock key={report.ticker} report={report} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ReportBlock({ report }: { report: Report }): ReactNode {
  return (
    <div className="rounded border border-hairline bg-panel/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{report.name}</span>
        <span className="rounded bg-panel-raised px-1.5 py-0.5 font-mono text-xs text-accent">
          ${report.ticker}
        </span>
        <ScreeningPill status={report.status} compact />
        {report.isPrimary ? (
          <span className="text-[10px] tracking-wider text-ink-faint uppercase">primary</span>
        ) : (
          <span className="text-[10px] tracking-wider text-ink-faint uppercase">alternate</span>
        )}
      </div>

      {!report.validation.valid ? (
        <p className="mt-2 rounded border border-caution/40 bg-caution/5 px-2 py-1.5 text-[11px] text-caution">
          Ticker issues: {report.validation.problems.join('; ')}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{report.statement}</p>
      <p className="mt-1 font-mono text-[10px] text-ink-faint">
        Searched at {formatDate(report.searchedAt)}
        {report.indexComplete ? '' : ' · index returned an incomplete result'}
      </p>

      {report.matches.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-[10px] tracking-wider text-ink-faint uppercase">
                <th className="py-1.5 pr-3 font-medium">Match type</th>
                <th className="py-1.5 pr-3 font-medium">Token</th>
                <th className="py-1.5 pr-3 font-medium">Market cap</th>
                <th className="py-1.5 pr-3 font-medium">ATH</th>
                <th className="py-1.5 pr-3 font-medium">Created</th>
                <th className="py-1.5 font-medium">Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {report.matches.map((match) => (
                <tr key={`${match.token.mintAddress}-${match.matchType}`}>
                  <td className="py-1.5 pr-3 text-ink-faint">{titleCase(match.matchType)}</td>
                  <td className="py-1.5 pr-3">
                    {match.token.url ? (
                      <a
                        href={match.token.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-accent hover:underline"
                      >
                        {match.token.name} (${match.token.ticker})
                      </a>
                    ) : (
                      <span className="text-ink">
                        {match.token.name} (${match.token.ticker})
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink tnum">
                    {formatUsd(match.token.marketCapUsd)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink-muted tnum">
                    {formatUsd(match.token.athMarketCapUsd)}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-muted">
                    {match.token.createdAt ? relativeTime(match.token.createdAt) : '—'}
                  </td>
                  <td className="py-1.5 text-ink-muted">{titleCase(match.quality)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
