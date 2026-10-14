import { type WalletSwap } from '@/lib/domain/wallet';

/**
 * Synthetic wallet-trading fixtures.
 *
 * A deterministic, clearly-labelled day of memecoin scalping so the wallet
 * scanner is fully demoable offline. Every swap is tagged SYNTHETIC_FIXTURE /
 * UNVERIFIED and the provider says so in its note — none of this is real
 * on-chain activity for any address.
 */

interface FixtureLeg {
  minuteOffset: number;
  direction: 'BUY' | 'SELL';
  tokenAmount: number;
  solAmount: number;
}

interface FixturePlay {
  symbol: string;
  mintSeed: string;
  legs: FixtureLeg[];
}

// A plausible pump.fun scalper's day: fixed-ish entries around 1.5 SOL,
// fast exits, one laddered runner, one loss cut, one still-open bag.
const PLAYS: FixturePlay[] = [
  {
    symbol: 'DEMO1',
    mintSeed: 'FixtureMint111',
    legs: [
      { minuteOffset: 0, direction: 'BUY', tokenAmount: 812_000, solAmount: 1.5 },
      { minuteOffset: 9, direction: 'SELL', tokenAmount: 812_000, solAmount: 2.31 },
    ],
  },
  {
    symbol: 'DEMO2',
    mintSeed: 'FixtureMint222',
    legs: [
      { minuteOffset: 34, direction: 'BUY', tokenAmount: 1_204_000, solAmount: 1.4 },
      { minuteOffset: 41, direction: 'SELL', tokenAmount: 1_204_000, solAmount: 0.92 },
    ],
  },
  {
    symbol: 'DEMO3',
    mintSeed: 'FixtureMint333',
    legs: [
      { minuteOffset: 95, direction: 'BUY', tokenAmount: 655_000, solAmount: 1.6 },
      { minuteOffset: 104, direction: 'SELL', tokenAmount: 327_500, solAmount: 1.55 },
      { minuteOffset: 131, direction: 'SELL', tokenAmount: 327_500, solAmount: 2.4 },
    ],
  },
  {
    symbol: 'DEMO4',
    mintSeed: 'FixtureMint444',
    legs: [
      { minuteOffset: 190, direction: 'BUY', tokenAmount: 940_000, solAmount: 1.5 },
      { minuteOffset: 203, direction: 'SELL', tokenAmount: 940_000, solAmount: 1.86 },
    ],
  },
  {
    symbol: 'DEMO5',
    mintSeed: 'FixtureMint555',
    legs: [
      { minuteOffset: 262, direction: 'BUY', tokenAmount: 2_050_000, solAmount: 1.55 },
      { minuteOffset: 274, direction: 'SELL', tokenAmount: 2_050_000, solAmount: 1.31 },
    ],
  },
  {
    symbol: 'DEMO6',
    mintSeed: 'FixtureMint666',
    legs: [
      { minuteOffset: 300, direction: 'BUY', tokenAmount: 730_000, solAmount: 1.45 },
      { minuteOffset: 318, direction: 'SELL', tokenAmount: 730_000, solAmount: 2.05 },
    ],
  },
  {
    symbol: 'DEMO7',
    mintSeed: 'FixtureMint777',
    legs: [{ minuteOffset: 355, direction: 'BUY', tokenAmount: 1_480_000, solAmount: 1.5 }],
  },
];

/** Deterministic swaps for one UTC day, starting mid-morning UTC. */
export function buildWalletTradeFixtures(windowStart: Date): WalletSwap[] {
  const dayAnchor = new Date(windowStart);
  dayAnchor.setUTCHours(9, 12, 0, 0);

  const swaps: WalletSwap[] = [];
  for (const play of PLAYS) {
    for (const [index, leg] of play.legs.entries()) {
      swaps.push({
        signature: `SYNTHETIC-${play.symbol}-${index}`,
        blockTime: new Date(dayAnchor.getTime() + leg.minuteOffset * 60_000),
        direction: leg.direction,
        mint: `${play.mintSeed}SyntheticFixtureXXXXXXXXXXXXXX`,
        tokenSymbol: play.symbol,
        tokenAmount: leg.tokenAmount,
        solAmount: leg.solAmount,
        venue: 'synthetic-demo-dex',
        source: 'SYNTHETIC_FIXTURE',
        confidence: 'UNVERIFIED',
      });
    }
  }
  return swaps;
}
