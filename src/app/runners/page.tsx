import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { EmptyState, ExternalLink, Panel, StatTile } from '@/components/primitives';
import { METAS_BY_ID } from '@/lib/runners/metas';
import type { DailyReport, Grade, SiteGradeRow, Trend } from '@/lib/runners/report';

export const dynamic = 'force-dynamic';

/** Reads the latest report written by `npm run runners:daily` (committed under data/). */
async function loadLatest(): Promise<DailyReport | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'runner-memory', 'latest.json'), 'utf8');
    return JSON.parse(raw) as DailyReport;
  } catch {
    return null;
  }
}

function usd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

const GRADE_TONE: Record<Grade, string> = {
  A: 'text-clean border-clean/50 bg-clean/10',
  B: 'text-clean border-clean/30 bg-clean/5',
  C: 'text-caution border-caution/40 bg-caution/10',
  D: 'text-occupied border-occupied/30 bg-occupied/5',
  F: 'text-occupied border-occupied/50 bg-occupied/10',
};

const TREND_TONE: Record<Trend, string> = {
  rising: 'text-clean',
  new: 'text-accent',
  steady: 'text-ink-muted',
  cooling: 'text-caution',
  absent: 'text-ink-faint',
};

function metaLabel(id: string): string {
  return METAS_BY_ID.get(id)?.label ?? 'Unclassified';
}

function SiteCard({ site }: { site: SiteGradeRow }): ReactNode {
  const change =
    site.previousGrade && site.previousGrade !== site.grade ? `${site.previousGrade} → ${site.grade}` : null;
  return (
    <article className="rounded-lg border border-hairline bg-panel p-4">
      <header className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded border font-mono text-lg font-bold ${GRADE_TONE[site.grade]}`}
        >
          {site.grade}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">{site.name}</h3>
          <p className="text-xs text-ink-muted">
            {site.verdict} · <span className="font-mono tnum">{site.score}</span>/100
            {change ? <span className="ml-1 text-accent">({change})</span> : null}
          </p>
        </div>
        {site.liveUrl ? <ExternalLink href={site.liveUrl}>site</ExternalLink> : null}
      </header>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {site.metaIds.map((id) => (
          <span key={id} className="rounded border border-hairline px-1.5 py-0.5 text-[11px] text-ink-muted">
            {metaLabel(id)}
          </span>
        ))}
        <span className="rounded border border-hairline px-1.5 py-0.5 text-[11px] text-ink-faint">
          {site.kind} · {site.readiness}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-faint tnum">
        fit {site.breakdown.metaFit}/45 · trend {site.breakdown.trend}/15 · ready {site.breakdown.readiness}/25 · orig{' '}
        {site.breakdown.originality}/15
      </p>
      <ul className="mt-2 space-y-1 text-xs text-ink-muted">
        {site.advice.map((a) => (
          <li key={a} className="flex gap-1.5">
            <span className="text-accent" aria-hidden>
              ›
            </span>
            <span>{a}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default async function RunnersPage(): Promise<ReactNode> {
  const report = await loadLatest();

  if (!report) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <EmptyState
          title="No runner scan yet"
          detail="Run `npm run runners:daily` to pull today's pump.fun runners, grade every site in data/sites.json, and start the memory."
        />
      </div>
    );
  }

  const hot = report.metaBoard.filter((m) => m.runnerCount > 0);
  const byName = new Map(report.sites.map((s) => [s.name, s]));
  const coinSites = report.sites.filter((s) => !s.metaIndependent);
  const tools = report.sites.filter((s) => s.metaIndependent);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Runners vs. our sites</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {report.date} · today&apos;s pump.fun runners classified into metas, and every site we have graded against
          them. Memory: {report.memoryDays} day{report.memoryDays === 1 ? '' : 's'}. Runner heat is what traded today,
          not a prediction.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Runners today" value={String(report.runnerCount)} hint="≤48h old or +100%, $100k+ vol" />
        <StatTile label="24h volume" value={usd(report.totalVolumeUsd)} />
        <StatTile
          label="Inflated MC"
          value={String(report.inflatedRunnerCount)}
          hint="MC > 60× liquidity, down-weighted"
          tone={report.inflatedRunnerCount > report.runnerCount / 3 ? 'warn' : 'default'}
        />
        <StatTile label="Hottest meta" value={hot[0] ? `${Math.round(hot[0].share * 100)}%` : '—'} hint={hot[0]?.label} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top 5 to push" subtitle="Best fit with what is running, weighted by readiness">
          <ol className="space-y-2">
            {report.top.map((name, i) => {
              const s = byName.get(name);
              return (
                <li key={name} className="flex items-center gap-2 text-sm">
                  <span className="w-4 font-mono text-ink-faint">{i + 1}</span>
                  {s ? <span className={`rounded border px-1.5 font-mono text-xs ${GRADE_TONE[s.grade]}`}>{s.grade}</span> : null}
                  <span className="text-ink">{name}</span>
                  <span className="ml-auto truncate text-xs text-ink-muted">{s?.advice[0]}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel title="Bottom 5" subtitle="Weakest fit today: rework or park">
          <ol className="space-y-2">
            {report.bottom.map((name, i) => {
              const s = byName.get(name);
              return (
                <li key={name} className="flex items-center gap-2 text-sm">
                  <span className="w-4 font-mono text-ink-faint">{i + 1}</span>
                  {s ? <span className={`rounded border px-1.5 font-mono text-xs ${GRADE_TONE[s.grade]}`}>{s.grade}</span> : null}
                  <span className="text-ink">{name}</span>
                  <span className="ml-auto truncate text-xs text-ink-muted">{s?.advice[0]}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <Panel title="Meta board" subtitle="Share of today's runner heat (log volume, inflated market caps down-weighted)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wider text-ink-faint uppercase">
              <tr>
                <th className="py-1 pr-3">Meta</th>
                <th className="py-1 pr-3">Share</th>
                <th className="py-1 pr-3">Trend</th>
                <th className="py-1 pr-3">Runners</th>
                <th className="py-1 pr-3">24h vol</th>
                <th className="py-1 pr-3">Inflated</th>
                <th className="py-1">Examples</th>
              </tr>
            </thead>
            <tbody>
              {hot.map((m) => (
                <tr key={m.metaId} className="border-t border-hairline">
                  <td className="py-1.5 pr-3 text-ink">{m.label}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded bg-hairline">
                        <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.min(100, m.share * 100)}%` }} />
                      </div>
                      <span className="font-mono text-xs tnum">{Math.round(m.share * 100)}%</span>
                    </div>
                  </td>
                  <td className={`py-1.5 pr-3 text-xs ${TREND_TONE[m.trend]}`}>
                    {m.trend}
                    {m.avgShare7d !== null ? ` (7d ${Math.round(m.avgShare7d * 100)}%)` : ''}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs tnum">{m.runnerCount}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs tnum">{usd(m.volumeUsd)}</td>
                  <td className={`py-1.5 pr-3 font-mono text-xs tnum ${m.inflatedShare >= 0.5 ? 'text-caution' : ''}`}>
                    {Math.round(m.inflatedShare * 100)}%
                  </td>
                  <td className="py-1.5 font-mono text-xs text-ink-muted">
                    {m.examples.map((e) => `$${e.symbol}`).join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`Coin sites (${coinSites.length})`} subtitle="Graded A–F against today's metas">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {coinSites.map((s) => (
            <SiteCard key={s.name} site={s} />
          ))}
        </div>
      </Panel>

      {tools.length ? (
        <Panel title={`Tools & bots (${tools.length})`} subtitle="Not meta-driven; graded on readiness and originality">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tools.map((s) => (
              <SiteCard key={s.name} site={s} />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Top runners" subtitle="Ranked by 24h volume heat">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wider text-ink-faint uppercase">
              <tr>
                <th className="py-1 pr-3">Ticker</th>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Meta</th>
                <th className="py-1 pr-3">24h vol</th>
                <th className="py-1 pr-3">MC</th>
                <th className="py-1 pr-3">Liq</th>
                <th className="py-1">Flags</th>
              </tr>
            </thead>
            <tbody>
              {report.runners.slice(0, 40).map((r) => (
                <tr key={r.mint} className="border-t border-hairline">
                  <td className="py-1.5 pr-3 font-mono text-xs">
                    {r.dexUrl ? <ExternalLink href={r.dexUrl}>${r.symbol}</ExternalLink> : `$${r.symbol}`}
                  </td>
                  <td className="max-w-48 truncate py-1.5 pr-3 text-ink">{r.name}</td>
                  <td className="py-1.5 pr-3 text-xs text-ink-muted">{r.metaIds.map(metaLabel).join(', ')}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs tnum">{usd(r.volume24hUsd)}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs tnum">{usd(r.marketCapUsd)}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs tnum">{usd(r.liquidityUsd)}</td>
                  <td className="py-1.5 text-xs text-caution">
                    {[r.flags.inflatedMcap ? 'inflated MC' : '', r.flags.copycatWave ? 'copycat' : ''].filter(Boolean).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {report.unclassifiedWords.length ? (
        <Panel title="Words the taxonomy doesn't cover yet" subtitle="Recurring runner words with no meta: candidates for a new meta">
          <div className="flex flex-wrap gap-1.5">
            {report.unclassifiedWords.map((w) => (
              <span key={w.word} className="rounded border border-hairline px-2 py-0.5 font-mono text-xs text-ink-muted">
                {w.word} <span className="text-ink-faint">{w.days}d · {usd(w.volumeUsd)}</span>
              </span>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
