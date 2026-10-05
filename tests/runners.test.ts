import { describe, expect, it } from 'vitest';
import { classifyText } from '@/lib/runners/metas';
import { INFLATED_MCAP_RATIO, rankRunners, type Runner } from '@/lib/runners/feed';
import { buildDailyReport, EMPTY_MEMORY, gradeFor, type SiteEntry } from '@/lib/runners/report';

const NOW = new Date('2026-10-04T12:00:00Z');

function candidate(over: Partial<Omit<Runner, 'flags' | 'heat'>>): Omit<Runner, 'flags' | 'heat'> {
  return {
    mint: over.mint ?? Math.random().toString(36).slice(2),
    name: 'Coin',
    symbol: 'COIN',
    description: '',
    createdAt: new Date(NOW.getTime() - 3_600_000),
    graduated: true,
    marketCapUsd: 1_000_000,
    athMarketCapUsd: null,
    liquidityUsd: 150_000,
    volume24hUsd: 500_000,
    priceChange24hPct: 20,
    txns24h: 1000,
    dexUrl: null,
    sources: ['pumpfun'],
    ...over,
  };
}

const opts = { now: NOW, maxAgeHours: 48, minVolumeUsd: 100_000 };

describe('classifyText', () => {
  it('matches word starts and reports the triggering terms', () => {
    const [top] = classifyText('World Oil Trust Fund');
    expect(top?.metaId).toBe('tokenized-fund');
    expect(top?.matchedTerms).toEqual(['fund', 'oil', 'trust']);
  });

  it('lets 3-letter animal terms match prefixes but keeps short ambiguous terms whole-word', () => {
    expect(classifyText('catius maximus').map((m) => m.metaId)).toContain('cats');
    expect(classifyText('apex legends').map((m) => m.metaId)).not.toContain('frogs-animals');
    expect(classifyText('fresh air').map((m) => m.metaId)).not.toContain('ai-agents');
    expect(classifyText('an AI agent launchpad').map((m) => m.metaId)).toEqual(
      expect.arrayContaining(['ai-agents', 'launchpad-platform']),
    );
  });

  it('matches mascot nouns glued onto the end of a ticker', () => {
    expect(classifyText('WHIPCAT').map((m) => m.metaId)).toContain('cats');
    expect(classifyText('Texcat').map((m) => m.metaId)).toContain('cats');
    expect(classifyText('SHIBLING').map((m) => m.metaId)).toContain('dogs');
    // Suffix matching stays limited to mascot nouns: "scatter" is not a cat.
    expect(classifyText('scatter plot').map((m) => m.metaId)).not.toContain('cats');
  });

  it('returns nothing for text with no meta keyword', () => {
    expect(classifyText('SPLICE')).toEqual([]);
  });
});

describe('rankRunners', () => {
  it('drops old, non-moving and low-volume coins', () => {
    const ranked = rankRunners(
      [
        candidate({ symbol: 'OK' }),
        candidate({ symbol: 'OLD', createdAt: new Date('2026-01-01') }),
        candidate({ symbol: 'RIP', createdAt: new Date('2026-01-01'), priceChange24hPct: 250 }),
        candidate({ symbol: 'DUST', volume24hUsd: 5_000 }),
      ],
      opts,
    );
    expect(ranked.map((r) => r.symbol).sort()).toEqual(['OK', 'RIP']);
  });

  it('flags and down-weights market caps far above liquidity', () => {
    const ranked = rankRunners(
      [
        candidate({ symbol: 'REAL' }),
        candidate({ symbol: 'LARP', marketCapUsd: 150_000 * (INFLATED_MCAP_RATIO + 1) }),
      ],
      opts,
    );
    const larp = ranked.find((r) => r.symbol === 'LARP')!;
    expect(larp.flags.inflatedMcap).toBe(true);
    expect(ranked[0]?.symbol).toBe('REAL');
  });

  it('marks copycat waves of the same symbol', () => {
    const ranked = rankRunners(
      [candidate({ symbol: 'SARP' }), candidate({ symbol: 'sarp' }), candidate({ symbol: 'SARP' })],
      opts,
    );
    expect(ranked.every((r) => r.flags.copycatWave)).toBe(true);
  });
});

describe('buildDailyReport', () => {
  const runners = rankRunners(
    [
      candidate({ symbol: 'AGENT', name: 'Super Agent', volume24hUsd: 5_000_000 }),
      candidate({ symbol: 'CLAUDIA', name: 'Claudia AI', volume24hUsd: 3_000_000 }),
      candidate({ symbol: 'KCAT', name: 'Knight Cat', volume24hUsd: 1_000_000 }),
      candidate({ symbol: 'DAWGS', name: 'Pump Dawgs', volume24hUsd: 200_000 }),
    ],
    opts,
  );

  const sites: SiteEntry[] = [
    { name: 'Sentia', kind: 'launchpad', concept: 'Launch an AI agent or AI influencer', themeKeywords: ['ai agent'], readiness: 'live' },
    { name: 'Uranium Reserve', kind: 'game', concept: 'uranium prospecting', themeKeywords: ['uranium'], readiness: 'idea-only' },
    { name: 'PUMP DAWGS', ticker: '$DAWGS', kind: 'nft', concept: 'dog nft', themeKeywords: ['dog'], readiness: 'built-not-deployed', openIssues: ['wallet placeholder in config'] },
    { name: 'MM Bot', kind: 'bot', concept: 'market making', readiness: 'built-not-deployed' },
    { name: 'Old Cat Game', kind: 'game', concept: 'cat game', themeKeywords: ['cat'], readiness: 'abandoned' },
  ];

  it('ranks a site in the hottest meta above one with no meta, and lists bottoms', () => {
    const { report } = buildDailyReport({ date: '2026-10-04', now: NOW, runners, sites, memory: EMPTY_MEMORY });
    expect(report.metaBoard[0]?.metaId).toBe('ai-agents');
    const sentia = report.sites.find((s) => s.name === 'Sentia')!;
    const uranium = report.sites.find((s) => s.name === 'Uranium Reserve')!;
    expect(sentia.score).toBeGreaterThan(uranium.score);
    expect(uranium.advice[0]).toMatch(/Hottest meta is AI agents/);
    expect(report.bottom[0]).toBe('Uranium Reserve');
    expect(report.top).not.toContain('MM Bot');
    expect(report.bottom).not.toContain('Old Cat Game');
    expect(report.abandoned).toEqual(['Old Cat Game']);
  });

  it('detects ticker collisions with today’s runners and surfaces deploy blockers', () => {
    const { report } = buildDailyReport({ date: '2026-10-04', now: NOW, runners, sites, memory: EMPTY_MEMORY });
    const dawgs = report.sites.find((s) => s.name === 'PUMP DAWGS')!;
    expect(dawgs.collisions[0]?.why).toMatch(/same ticker/);
    expect(dawgs.advice.join(' ')).toMatch(/wallet placeholder/);
  });

  it('accumulates memory across days, replaces same-day reruns, and computes trends', () => {
    const day1 = buildDailyReport({ date: '2026-10-03', now: NOW, runners, sites, memory: EMPTY_MEMORY });
    const rerun = buildDailyReport({ date: '2026-10-03', now: NOW, runners, sites, memory: day1.memory });
    expect(rerun.memory.days).toHaveLength(1);
    expect(rerun.memory.words).toEqual(day1.memory.words);

    // Day 2: only the cat runner trades, so AI agents cool and cats rise.
    const catsOnly = runners.filter((r) => r.symbol === 'KCAT');
    const day2 = buildDailyReport({ date: '2026-10-04', now: NOW, runners: catsOnly, sites, memory: rerun.memory });
    const row = (id: string) => day2.report.metaBoard.find((m) => m.metaId === id)!;
    expect(row('ai-agents').trend).toBe('cooling');
    expect(row('cats').trend).toBe('rising');
    expect(day2.memory.days.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-04']);
    expect(day2.report.sites.find((s) => s.name === 'Sentia')!.previousGrade).not.toBeNull();
  });

  it('maps scores to grades', () => {
    expect([80, 65, 50, 35, 10].map(gradeFor)).toEqual(['A', 'B', 'C', 'D', 'F']);
  });
});
