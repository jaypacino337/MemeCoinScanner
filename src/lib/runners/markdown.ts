import type { DailyReport } from './report';

function usd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\n/g, ' ');

/** Renders the daily report as a markdown brief (committed under reports/runners/). */
export function renderReportMarkdown(r: DailyReport): string {
  const out: string[] = [];
  out.push(`# Runners vs. our sites — ${r.date}`);
  out.push('');
  out.push(
    `${r.runnerCount} runners today (created in the last 48h or up 100%+ in 24h, $100k+ 24h volume), ${usd(r.totalVolumeUsd)} combined 24h volume. ` +
      `${r.inflatedRunnerCount} have market caps more than 60× their liquidity and are down-weighted. Memory: ${r.memoryDays} day(s).`,
  );
  out.push('');
  out.push('> Descriptive only. Runner heat is what traded today, not a prediction of what will.');
  out.push('');

  out.push('## Meta board');
  out.push('');
  out.push('| Meta | Share of heat | Trend | Runners | 24h volume | Inflated | Examples |');
  out.push('|---|---|---|---|---|---|---|');
  for (const m of r.metaBoard.filter((m) => m.runnerCount > 0)) {
    const trend = m.avgShare7d === null ? m.trend : `${m.trend} (7d avg ${pct(m.avgShare7d)})`;
    out.push(
      `| ${m.label} | ${pct(m.share)} | ${trend} | ${m.runnerCount} | ${usd(m.volumeUsd)} | ${pct(m.inflatedShare)} | ${cell(
        m.examples.map((e) => `$${e.symbol}`).join(', '),
      )} |`,
    );
  }
  out.push('');

  out.push('## Site grades');
  out.push('');
  out.push(`**Top 5:** ${r.top.join(', ') || '—'}  `);
  out.push(`**Bottom 5 (still in play):** ${r.bottom.join(', ') || '—'}  `);
  out.push(`**Abandoned:** ${r.abandoned.join(', ') || '—'}`);
  out.push('');
  out.push('| Grade | Site | Score | Metas | Readiness | Verdict | Change |');
  out.push('|---|---|---|---|---|---|---|');
  for (const s of r.sites) {
    const change = s.previousGrade === null ? 'new' : s.previousGrade === s.grade ? '=' : `${s.previousGrade} → ${s.grade}`;
    out.push(
      `| **${s.grade}** | ${cell(s.name)} | ${s.score} | ${s.metaIds.join(', ')} | ${s.readiness} | ${s.verdict} | ${change} |`,
    );
  }
  out.push('');

  out.push('## Advice by site');
  out.push('');
  for (const s of r.sites) {
    out.push(`### ${s.grade} · ${s.name} (${s.score})`);
    out.push(
      `meta fit ${s.breakdown.metaFit}/45 · trend ${s.breakdown.trend}/15 · readiness ${s.breakdown.readiness}/25 · originality ${s.breakdown.originality}/15`,
    );
    for (const a of s.advice) out.push(`- ${a}`);
    out.push('');
  }

  out.push('## Top runners today');
  out.push('');
  out.push('| Ticker | Name | Metas | 24h vol | MC | Liquidity | 24h % | Flags |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const x of r.runners.slice(0, 30)) {
    const flags = [x.flags.inflatedMcap ? 'inflated MC' : '', x.flags.copycatWave ? 'copycat wave' : '']
      .filter(Boolean)
      .join(', ');
    out.push(
      `| $${cell(x.symbol)} | ${cell(x.name)} | ${x.metaIds.join(', ')} | ${usd(x.volume24hUsd)} | ${usd(x.marketCapUsd)} | ${usd(
        x.liquidityUsd,
      )} | ${x.priceChange24hPct === null ? '—' : `${Math.round(x.priceChange24hPct)}%`} | ${flags || '—'} |`,
    );
  }
  out.push('');

  if (r.unclassifiedWords.length) {
    out.push('## Words the taxonomy does not cover yet');
    out.push('');
    out.push('Recurring words in runners that hit no meta. Candidates for a new meta once they persist.');
    out.push('');
    out.push(r.unclassifiedWords.map((w) => `\`${w.word}\` (${w.days}d, ${usd(w.volumeUsd)})`).join(' · '));
    out.push('');
  }

  out.push('## Sources');
  out.push('');
  for (const [k, v] of Object.entries(r.sourceStatus)) out.push(`- ${k}: ${v}`);
  out.push('');
  return out.join('\n');
}
