import { classifyText, METAS, METAS_BY_ID, UNCLASSIFIED, wordsOf } from './metas';
import type { Runner } from './feed';

/**
 * Daily "runners vs. our sites" report.
 *
 * Pure: takes today's runners, the site inventory, and yesterday's memory, and
 * returns today's report plus the updated memory. No I/O, so the whole thing is
 * unit-tested with plain objects.
 *
 * What it learns over time (all stored in `RunnerMemory`):
 *  - each meta's share of runner heat per day → rising / steady / cooling trends
 *  - each site's grade per day → whether a site is getting better or worse
 *  - words that keep appearing in runners but match no meta → candidates for
 *    new metas (the taxonomy is extended by hand from this list)
 */

export type Readiness = 'live' | 'built-not-deployed' | 'in-progress' | 'idea-only' | 'abandoned';

export interface SiteEntry {
  name: string;
  aliases?: string[];
  ticker?: string | null;
  sessionIds?: string[];
  repo?: string | null;
  kind: string;
  concept: string;
  themeKeywords?: string[];
  referenceSite?: string | null;
  liveUrl?: string | null;
  readiness: Readiness;
  openIssues?: string[];
  lastActive?: string | null;
}

export type Trend = 'rising' | 'steady' | 'cooling' | 'new' | 'absent';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface MemoryDay {
  date: string;
  /** Meta id → share of total runner heat that day (0..1). */
  metaShare: Record<string, number>;
  runnerCount: number;
}

export interface RunnerMemory {
  version: 1;
  days: MemoryDay[];
  siteGrades: Record<string, Array<{ date: string; grade: Grade; score: number }>>;
  /** Unclassified runner words: on how many days seen, and total volume behind them. */
  words: Record<string, { days: number; lastSeen: string; volumeUsd: number }>;
}

export const EMPTY_MEMORY: RunnerMemory = { version: 1, days: [], siteGrades: {}, words: {} };

export interface ClassifiedRunner {
  symbol: string;
  name: string;
  mint: string;
  metaIds: string[];
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  priceChange24hPct: number | null;
  heat: number;
  flags: Runner['flags'];
  dexUrl: string | null;
}

export interface MetaRow {
  metaId: string;
  label: string;
  blurb: string;
  share: number;
  runnerCount: number;
  volumeUsd: number;
  /** Share of this meta's runners flagged inflatedMcap — high means suspect heat. */
  inflatedShare: number;
  avgShare7d: number | null;
  trend: Trend;
  /** Consecutive prior days with falling share (for "park it" advice). */
  coolingStreak: number;
  examples: Array<{ symbol: string; name: string; volume24hUsd: number | null }>;
}

export interface SiteGradeRow {
  name: string;
  kind: string;
  readiness: Readiness;
  liveUrl: string | null;
  metaIds: string[];
  metaIndependent: boolean;
  score: number;
  grade: Grade;
  breakdown: { metaFit: number; trend: number; readiness: number; originality: number };
  /** Runners today that share this site's name, ticker or a core keyword. */
  collisions: Array<{ symbol: string; name: string; volume24hUsd: number | null; why: string }>;
  previousGrade: Grade | null;
  verdict: string;
  advice: string[];
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  runnerCount: number;
  totalVolumeUsd: number;
  inflatedRunnerCount: number;
  metaBoard: MetaRow[];
  runners: ClassifiedRunner[];
  sites: SiteGradeRow[];
  top: string[];
  bottom: string[];
  abandoned: string[];
  unclassifiedWords: Array<{ word: string; days: number; volumeUsd: number }>;
  sourceStatus: Record<string, string>;
  memoryDays: number;
}

const META_INDEPENDENT_KINDS = new Set(['bot', 'trading-tool', 'scanner/analytics', 'tooling']);

const READINESS_POINTS: Record<Readiness, number> = {
  live: 25,
  'built-not-deployed': 18,
  'in-progress': 10,
  'idea-only': 5,
  abandoned: 0,
};

const TREND_POINTS: Record<Trend, number> = { rising: 15, new: 9, steady: 8, cooling: 2, absent: 0 };

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export function gradeFor(score: number): Grade {
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function usd(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

export function classifyRunner(r: Runner): ClassifiedRunner {
  const matches = classifyText(`${r.name} ${r.symbol} ${r.description}`);
  return {
    symbol: r.symbol,
    name: r.name,
    mint: r.mint,
    metaIds: matches.length ? matches.slice(0, 3).map((m) => m.metaId) : [UNCLASSIFIED],
    volume24hUsd: r.volume24hUsd,
    marketCapUsd: r.marketCapUsd,
    liquidityUsd: r.liquidityUsd,
    priceChange24hPct: r.priceChange24hPct,
    heat: r.heat,
    flags: r.flags,
    dexUrl: r.dexUrl,
  };
}

function trendOf(today: number, history: MemoryDay[], metaId: string): { trend: Trend; avg: number | null; streak: number } {
  const recent = history.slice(-7);
  if (recent.length === 0) return { trend: today > 0 ? 'new' : 'absent', avg: null, streak: 0 };
  const shares = recent.map((d) => d.metaShare[metaId] ?? 0);
  const avg = shares.reduce((a, b) => a + b, 0) / shares.length;

  // Count consecutive declines ending at today.
  let streak = 0;
  let next = today;
  for (let i = shares.length - 1; i >= 0; i -= 1) {
    const prev = shares[i] ?? 0;
    if (prev > next) {
      streak += 1;
      next = prev;
    } else break;
  }

  let trend: Trend;
  if (today === 0) trend = avg > 0 ? 'cooling' : 'absent';
  else if (avg === 0) trend = 'new';
  else if (today >= avg * 1.25) trend = 'rising';
  else if (today <= avg * 0.75) trend = 'cooling';
  else trend = 'steady';
  return { trend, avg: round(avg, 3), streak };
}

/**
 * A site's metas come from its name, ticker and theme keywords. The free-text
 * concept is only a fallback: it is full of incidental words ("Solana",
 * "airdrop", "fees") that would put every site in every meta.
 */
function classifySite(site: SiteEntry): ReturnType<typeof classifyText> {
  const core = classifyText([site.name, ...(site.aliases ?? []), site.ticker ?? '', ...(site.themeKeywords ?? [])].join(' '));
  return core.length ? core : classifyText(site.concept);
}

function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCollisions(site: SiteEntry, runners: ClassifiedRunner[]): SiteGradeRow['collisions'] {
  const names = [site.name, ...(site.aliases ?? [])].map(canon).filter((n) => n.length >= 3);
  const ticker = site.ticker ? canon(site.ticker) : null;
  const out: SiteGradeRow['collisions'] = [];
  for (const r of runners) {
    const rs = canon(r.symbol);
    const rn = canon(r.name);
    let why: string | null = null;
    if (ticker && ticker.length >= 2 && rs === ticker) why = `same ticker $${r.symbol}`;
    else if (names.some((n) => rn === n || rs === n)) why = 'same name';
    else if (names.some((n) => n.length >= 5 && (rn.includes(n) || (rn.length >= 5 && n.includes(rn))))) why = 'name overlap';
    if (why) out.push({ symbol: r.symbol, name: r.name, volume24hUsd: r.volume24hUsd, why });
  }
  return out.slice(0, 5);
}

export function buildDailyReport(input: {
  date: string;
  now: Date;
  runners: Runner[];
  sites: SiteEntry[];
  memory: RunnerMemory;
  sourceStatus?: Record<string, string>;
}): { report: DailyReport; memory: RunnerMemory } {
  const { date, now, sites } = input;
  // Memory is keyed by date; re-running the same day replaces that day.
  const history = input.memory.days.filter((d) => d.date < date);
  const classified = input.runners.map(classifyRunner);

  // ---- Meta board -------------------------------------------------------
  const totalHeat = classified.reduce((a, r) => a + r.heat, 0) || 1;
  const metaIds = [...METAS.map((m) => m.id), UNCLASSIFIED];
  const metaShare: Record<string, number> = {};
  const metaBoard: MetaRow[] = metaIds.map((metaId) => {
    // A runner in several metas splits its heat between them.
    const members = classified.filter((r) => r.metaIds.includes(metaId));
    const heat = members.reduce((a, r) => a + r.heat / r.metaIds.length, 0);
    const share = round(heat / totalHeat, 3);
    metaShare[metaId] = share;
    const { trend, avg, streak } = trendOf(share, history, metaId);
    const def = METAS_BY_ID.get(metaId);
    return {
      metaId,
      label: def?.label ?? 'Unclassified',
      blurb: def?.blurb ?? 'Runners whose name and description hit no meta keyword.',
      share,
      runnerCount: members.length,
      volumeUsd: Math.round(members.reduce((a, r) => a + (r.volume24hUsd ?? 0), 0)),
      inflatedShare: members.length ? round(members.filter((r) => r.flags.inflatedMcap).length / members.length) : 0,
      avgShare7d: avg,
      trend,
      coolingStreak: streak,
      examples: members.slice(0, 4).map((r) => ({ symbol: r.symbol, name: r.name, volume24hUsd: r.volume24hUsd })),
    };
  });
  metaBoard.sort((a, b) => b.share - a.share);
  const metaRow = new Map(metaBoard.map((m) => [m.metaId, m]));
  const hottest = metaBoard.filter((m) => m.metaId !== UNCLASSIFIED && m.share > 0);

  // ---- Site grades ------------------------------------------------------
  const siteRows: SiteGradeRow[] = sites.map((site) => {
    const matches = classifySite(site);
    const siteMetaIds = matches.slice(0, 3).map((m) => m.metaId);
    const metaIndependent = META_INDEPENDENT_KINDS.has(site.kind);
    const rows = siteMetaIds.map((id) => metaRow.get(id)).filter((r): r is MetaRow => Boolean(r));
    const best = [...rows].sort((a, b) => b.share - a.share)[0] ?? null;

    let metaFit: number;
    let trendPts: number;
    if (metaIndependent) {
      metaFit = 25;
      trendPts = 8;
    } else {
      const primary = best ? Math.min(1, best.share / 0.2) * 38 : 0;
      const secondary = rows
        .filter((r) => r !== best)
        .reduce((a, r) => a + Math.min(1, r.share / 0.2) * 7, 0);
      // Heat that comes mostly from inflated-mcap tokens counts for less.
      const suspect = best ? 1 - best.inflatedShare * 0.4 : 1;
      metaFit = Math.min(45, (primary + secondary) * suspect);
      trendPts = best ? TREND_POINTS[best.trend] : 0;
    }

    const collisions = findCollisions(site, classified);
    let originality = 15;
    if (site.referenceSite) originality -= 6;
    if (collisions.length) originality -= 6;

    const readinessPts = READINESS_POINTS[site.readiness] ?? 0;
    const score = round(metaFit + trendPts + readinessPts + Math.max(0, originality), 1);
    const grade = gradeFor(score);
    const past = input.memory.siteGrades[site.name]?.filter((g) => g.date < date) ?? [];
    const previousGrade = past.at(-1)?.grade ?? null;

    // ---- Advice ---------------------------------------------------------
    const advice: string[] = [];
    const metaName = best ? best.label : 'no tracked meta';
    if (metaIndependent) {
      advice.push('Tooling, not a coin narrative: graded on readiness and originality only.');
    } else if (!best || best.share === 0) {
      const alt = hottest[0];
      advice.push(
        `Nothing in ${siteMetaIds.length ? siteMetaIds.map((id) => METAS_BY_ID.get(id)?.label ?? id).join(' / ') : 'its theme'} is running today.` +
          (alt
            ? ` Hottest meta is ${alt.label} (${alt.runnerCount} runners, ${usd(alt.volumeUsd)} volume). A reskin toward it is the cheapest upgrade.`
            : ''),
      );
    } else {
      const ex = best.examples.slice(0, 3).map((e) => `$${e.symbol}`).join(', ');
      if (best.trend === 'rising' || best.trend === 'new') {
        advice.push(`${best.label} is ${best.trend === 'new' ? 'showing up' : 'heating up'} today: ${best.runnerCount} runners, ${usd(best.volumeUsd)} volume (${ex}).`);
      } else if (best.trend === 'cooling') {
        advice.push(`${best.label} is cooling (${Math.round(best.share * 100)}% of heat vs ${Math.round((best.avgShare7d ?? 0) * 100)}% 7-day average).`);
      } else {
        advice.push(`${best.label} holds ${Math.round(best.share * 100)}% of today's runner heat (${ex}).`);
      }
      if (best.inflatedShare >= 0.5) {
        advice.push(`Caution: ${Math.round(best.inflatedShare * 100)}% of ${best.label} runners have market caps far above their liquidity, so treat that heat as suspect.`);
      }
      if (best.coolingStreak >= 3) advice.push(`${best.label} has fallen ${best.coolingStreak} days running: park this one unless it has a hook outside the meta.`);
    }
    if (collisions.length) {
      const c = collisions[0]!;
      advice.push(`$${c.symbol} (${c.name}) is running today (${c.why}, ${usd(c.volume24hUsd)} vol). Either ride it as a companion/utility site or rename before launch.`);
    }
    if (site.referenceSite) advice.push(`Built off ${site.referenceSite}: give it one feature or joke the original doesn't have before pushing it.`);
    if (site.readiness === 'built-not-deployed') {
      advice.push(`Built but not live.${site.openIssues?.[0] ? ` First blocker: ${site.openIssues[0]}` : ' Deploy it.'}`);
    } else if (site.readiness === 'in-progress' && site.openIssues?.[0]) {
      advice.push(`Next step: ${site.openIssues[0]}`);
    } else if (site.readiness === 'abandoned') {
      advice.push('Marked abandoned: revive only if its meta is rising.');
    }

    const verdict =
      grade === 'A' ? 'Push now' :
      grade === 'B' ? 'Strong: finish & ship' :
      grade === 'C' ? 'Hold: needs a sharper hook or a deploy' :
      grade === 'D' ? 'Weak: rework toward a hot meta' :
      'Park it';

    return {
      name: site.name,
      kind: site.kind,
      readiness: site.readiness,
      liveUrl: site.liveUrl ?? null,
      metaIds: siteMetaIds.length ? siteMetaIds : [UNCLASSIFIED],
      metaIndependent,
      score,
      grade,
      breakdown: { metaFit: round(metaFit, 1), trend: trendPts, readiness: readinessPts, originality: Math.max(0, originality) },
      collisions,
      previousGrade,
      verdict: metaName === 'no tracked meta' && !metaIndependent ? `${verdict} (no meta match)` : verdict,
      advice,
    };
  });
  siteRows.sort((a, b) => b.score - a.score);

  // ---- Learning: unclassified words ------------------------------------
  const words: RunnerMemory['words'] = { ...input.memory.words };
  const todayWords = new Map<string, number>();
  for (const r of classified) {
    if (!r.metaIds.includes(UNCLASSIFIED)) continue;
    for (const w of new Set(wordsOf(`${r.name} ${r.symbol}`))) {
      todayWords.set(w, (todayWords.get(w) ?? 0) + (r.volume24hUsd ?? 0));
    }
  }
  for (const [w, vol] of todayWords) {
    const prev = words[w];
    // A same-day re-run must not double count.
    if (prev?.lastSeen === date) continue;
    words[w] = { days: (prev?.days ?? 0) + 1, lastSeen: date, volumeUsd: Math.round((prev?.volumeUsd ?? 0) + vol) };
  }

  const memory: RunnerMemory = {
    version: 1,
    days: [...history, { date, metaShare, runnerCount: classified.length }].slice(-90),
    siteGrades: { ...input.memory.siteGrades },
    words,
  };
  for (const row of siteRows) {
    const prior = (memory.siteGrades[row.name] ?? []).filter((g) => g.date !== date);
    memory.siteGrades[row.name] = [...prior, { date, grade: row.grade, score: row.score }].slice(-90);
  }

  // Top/bottom compare the sites still in play; abandoned ones are listed apart.
  const graded = siteRows.filter((s) => !s.metaIndependent && s.readiness !== 'abandoned');
  const report: DailyReport = {
    date,
    generatedAt: now.toISOString(),
    runnerCount: classified.length,
    totalVolumeUsd: Math.round(classified.reduce((a, r) => a + (r.volume24hUsd ?? 0), 0)),
    inflatedRunnerCount: classified.filter((r) => r.flags.inflatedMcap).length,
    metaBoard,
    runners: classified.slice(0, 60),
    sites: siteRows,
    top: graded.slice(0, 5).map((s) => s.name),
    bottom: graded.slice(-5).reverse().map((s) => s.name),
    abandoned: siteRows.filter((s) => s.readiness === 'abandoned').map((s) => s.name),
    unclassifiedWords: Object.entries(words)
      .map(([word, v]) => ({ word, days: v.days, volumeUsd: v.volumeUsd }))
      .sort((a, b) => b.days - a.days || b.volumeUsd - a.volumeUsd)
      .slice(0, 15),
    sourceStatus: input.sourceStatus ?? {},
    memoryDays: memory.days.length,
  };
  return { report, memory };
}
