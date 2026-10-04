import { z } from 'zod';

/**
 * "Runners of the day" feed.
 *
 * Candidate pool: pump.fun's public coin list (largest market caps + currently
 * live) plus DexScreener's boosted Solana tokens. Every candidate is then
 * enriched from DexScreener pair data, because pump.fun's `usd_market_cap`
 * alone is not trustworthy: tokens with most of the supply parked in one place
 * report nine-figure market caps on a few million of liquidity. Those are kept
 * (the volume behind them is real) but flagged `inflatedMcap` and down-weighted
 * so they cannot dominate what the report learns.
 *
 * Nothing here fabricates a number: a field the upstream did not return stays
 * null, and the report states which sources answered.
 */

const PUMP_BASE = 'https://frontend-api-v3.pump.fun';
const DEX_BASE = 'https://api.dexscreener.com';

/** Market cap more than this multiple of pool liquidity reads as inflated. */
export const INFLATED_MCAP_RATIO = 60;

export interface Runner {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  createdAt: Date | null;
  /** True once the bonding curve completed (graduated off pump.fun's curve). */
  graduated: boolean | null;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  txns24h: number | null;
  dexUrl: string | null;
  sources: Array<'pumpfun' | 'pumpfun-live' | 'dexscreener-boost'>;
  flags: {
    inflatedMcap: boolean;
    /** Three or more same-symbol launches in the pool: a copycat wave. */
    copycatWave: boolean;
  };
  /** Ranking weight: log-scaled 24h volume, discounted by flags. */
  heat: number;
}

const pumpCoinSchema = z.object({
  mint: z.string(),
  name: z.string().default(''),
  symbol: z.string().default(''),
  description: z.string().nullable().optional(),
  created_timestamp: z.number().nullable().optional(),
  complete: z.boolean().nullable().optional(),
  usd_market_cap: z.number().nullable().optional(),
  ath_market_cap: z.number().nullable().optional(),
});

const dexPairSchema = z.object({
  url: z.string().optional(),
  baseToken: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }),
  liquidity: z.object({ usd: z.number().optional() }).nullable().optional(),
  volume: z.object({ h24: z.number().optional() }).nullable().optional(),
  priceChange: z.object({ h24: z.number().optional() }).nullable().optional(),
  txns: z
    .object({ h24: z.object({ buys: z.number(), sells: z.number() }).optional() })
    .nullable()
    .optional(),
  marketCap: z.number().optional(),
  fdv: z.number().optional(),
  pairCreatedAt: z.number().optional(),
});

const boostSchema = z.object({
  chainId: z.string(),
  tokenAddress: z.string(),
  description: z.string().optional(),
});

export interface FeedOptions {
  fetchImpl?: typeof fetch;
  /** pump.fun pages of 50, sorted by market cap. */
  pumpPages?: number;
  /** Runners must have been created inside this many hours, or moved ≥100% today. */
  maxAgeHours?: number;
  minVolumeUsd?: number;
  now?: Date;
}

export interface FeedResult {
  runners: Runner[];
  fetchedAt: Date;
  /** Per-source outcome so the report can say what answered. */
  sourceStatus: Record<string, string>;
  candidatesSeen: number;
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (RunnerScan/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface Candidate {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  createdAt: Date | null;
  graduated: boolean | null;
  marketCapUsd: number | null;
  athMarketCapUsd: number | null;
  sources: Set<Runner['sources'][number]>;
}

function fromPump(raw: unknown, source: 'pumpfun' | 'pumpfun-live', into: Map<string, Candidate>): number {
  const list = Array.isArray(raw) ? raw : [];
  let n = 0;
  for (const item of list) {
    const parsed = pumpCoinSchema.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    const existing = into.get(c.mint);
    if (existing) {
      existing.sources.add(source);
      continue;
    }
    into.set(c.mint, {
      mint: c.mint,
      name: c.name,
      symbol: c.symbol,
      description: c.description ?? '',
      createdAt: c.created_timestamp ? new Date(c.created_timestamp) : null,
      graduated: c.complete ?? null,
      marketCapUsd: c.usd_market_cap ?? null,
      athMarketCapUsd: c.ath_market_cap ?? null,
      sources: new Set([source]),
    });
    n += 1;
  }
  return n;
}

/** Pure ranking step, exported for tests. */
export function rankRunners(
  candidates: Array<Omit<Runner, 'flags' | 'heat'>>,
  options: { now: Date; maxAgeHours: number; minVolumeUsd: number },
): Runner[] {
  const symbolCounts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.symbol.toUpperCase();
    symbolCounts.set(key, (symbolCounts.get(key) ?? 0) + 1);
  }

  const cutoff = options.now.getTime() - options.maxAgeHours * 3_600_000;
  const runners: Runner[] = [];
  for (const c of candidates) {
    const volume = c.volume24hUsd ?? 0;
    if (volume < options.minVolumeUsd) continue;
    const fresh = c.createdAt !== null && c.createdAt.getTime() >= cutoff;
    const ripping = (c.priceChange24hPct ?? 0) >= 100;
    if (!fresh && !ripping) continue;

    const inflatedMcap =
      c.marketCapUsd !== null &&
      c.liquidityUsd !== null &&
      c.liquidityUsd > 0 &&
      c.marketCapUsd / c.liquidityUsd > INFLATED_MCAP_RATIO;
    const copycatWave = (symbolCounts.get(c.symbol.toUpperCase()) ?? 0) >= 3;

    let heat = Math.log10(Math.max(volume, 1));
    if (inflatedMcap) heat *= 0.35;
    if (copycatWave) heat *= 0.8;

    runners.push({ ...c, flags: { inflatedMcap, copycatWave }, heat: Math.round(heat * 100) / 100 });
  }
  return runners.sort((a, b) => b.heat - a.heat || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
}

export async function fetchRunners(options: FeedOptions = {}): Promise<FeedResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const sourceStatus: Record<string, string> = {};
  const pool = new Map<string, Candidate>();

  const pages = options.pumpPages ?? 6;
  let pumpOk = 0;
  for (let page = 0; page < pages; page += 1) {
    const url = `${PUMP_BASE}/coins?offset=${page * 50}&limit=50&sort=market_cap&order=DESC&includeNsfw=false`;
    try {
      pumpOk += fromPump(await getJson(fetchImpl, url), 'pumpfun', pool);
    } catch (error) {
      sourceStatus[`pumpfun:page${page}`] = `failed: ${(error as Error).message}`;
    }
  }
  sourceStatus.pumpfun = `${pumpOk} coins`;

  try {
    const n = fromPump(
      await getJson(fetchImpl, `${PUMP_BASE}/coins/currently-live?offset=0&limit=50&includeNsfw=false`),
      'pumpfun-live',
      pool,
    );
    sourceStatus['pumpfun-live'] = `${n} new coins`;
  } catch (error) {
    sourceStatus['pumpfun-live'] = `failed: ${(error as Error).message}`;
  }

  const boosted = new Set<string>();
  for (const path of ['/token-boosts/top/v1', '/token-boosts/latest/v1']) {
    try {
      const raw = await getJson(fetchImpl, `${DEX_BASE}${path}`);
      for (const item of Array.isArray(raw) ? raw : []) {
        const parsed = boostSchema.safeParse(item);
        if (parsed.success && parsed.data.chainId === 'solana') boosted.add(parsed.data.tokenAddress);
      }
      sourceStatus[`dexscreener${path}`] = 'ok';
    } catch (error) {
      sourceStatus[`dexscreener${path}`] = `failed: ${(error as Error).message}`;
    }
  }

  // Enrich everything (pump + boosted) from DexScreener pair data, 30 per call.
  const mints = [...new Set([...pool.keys(), ...boosted])];
  const best = new Map<string, z.infer<typeof dexPairSchema>>();
  let dexFailures = 0;
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const raw = await getJson(fetchImpl, `${DEX_BASE}/tokens/v1/solana/${chunk.join(',')}`);
      for (const item of Array.isArray(raw) ? raw : []) {
        const parsed = dexPairSchema.safeParse(item);
        if (!parsed.success) continue;
        const pair = parsed.data;
        const mint = pair.baseToken.address;
        const prev = best.get(mint);
        if (!prev || (pair.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, pair);
      }
    } catch {
      dexFailures += 1;
    }
  }
  sourceStatus.dexscreener = `${best.size} tokens enriched${dexFailures ? `, ${dexFailures} batch(es) failed` : ''}`;

  const candidates: Array<Omit<Runner, 'flags' | 'heat'>> = [];
  for (const mint of mints) {
    const pump = pool.get(mint);
    const pair = best.get(mint);
    if (!pump && !pair) continue;
    const sources = new Set(pump?.sources ?? []);
    if (boosted.has(mint)) sources.add('dexscreener-boost');
    const txns = pair?.txns?.h24;
    candidates.push({
      mint,
      name: pump?.name || pair?.baseToken.name || '',
      symbol: pump?.symbol || pair?.baseToken.symbol || '',
      description: pump?.description ?? '',
      createdAt: pump?.createdAt ?? (pair?.pairCreatedAt ? new Date(pair.pairCreatedAt) : null),
      graduated: pump?.graduated ?? null,
      marketCapUsd: pair?.marketCap ?? pump?.marketCapUsd ?? null,
      athMarketCapUsd: pump?.athMarketCapUsd ?? null,
      liquidityUsd: pair?.liquidity?.usd ?? null,
      volume24hUsd: pair?.volume?.h24 ?? null,
      priceChange24hPct: pair?.priceChange?.h24 ?? null,
      txns24h: txns ? txns.buys + txns.sells : null,
      dexUrl: pair?.url ?? null,
      sources: [...sources],
    });
  }

  return {
    runners: rankRunners(candidates, {
      now,
      maxAgeHours: options.maxAgeHours ?? 48,
      minVolumeUsd: options.minVolumeUsd ?? 100_000,
    }),
    fetchedAt: now,
    sourceStatus,
    candidatesSeen: candidates.length,
  };
}
