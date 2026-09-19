import { describe, expect, it } from 'vitest';
import { SOL_MINT, type WalletSwap, type WalletSwapBatch } from '../src/lib/domain/wallet';
import { buildWalletTradeFixtures } from '../src/lib/fixtures/wallet-trades';
import {
  analyzeWalletActivity,
  buildPositions,
  summarize,
} from '../src/lib/pipeline/wallet-analysis';
import { parseSwap } from '../src/lib/providers/wallet-rpc';

const T0 = new Date('2026-09-19T10:00:00Z');
const minutes = (m: number): Date => new Date(T0.getTime() + m * 60_000);

function swap(overrides: Partial<WalletSwap>): WalletSwap {
  return {
    signature: 'sig',
    blockTime: T0,
    direction: 'BUY',
    mint: 'MintA',
    tokenSymbol: null,
    tokenAmount: 1000,
    solAmount: 1,
    venue: null,
    source: 'OFFICIAL_API',
    confidence: 'HIGH',
    ...overrides,
  };
}

function batchOf(swaps: WalletSwap[]): WalletSwapBatch {
  return {
    address: 'Wallet11111111111111111111111111111111111111',
    windowStart: T0,
    windowEnd: minutes(24 * 60),
    swaps,
    unparsedTransactions: 0,
    fetchedAt: minutes(24 * 60),
    complete: true,
  };
}

describe('buildPositions', () => {
  it('pairs buys and sells into a closed position with realized PnL and hold time', () => {
    const positions = buildPositions([
      swap({ direction: 'BUY', tokenAmount: 1000, solAmount: 1.5, blockTime: minutes(0) }),
      swap({ direction: 'SELL', tokenAmount: 1000, solAmount: 2.1, blockTime: minutes(12) }),
    ]);
    expect(positions).toHaveLength(1);
    const position = positions[0]!;
    expect(position.status).toBe('CLOSED');
    expect(position.realizedPnlSol).toBeCloseTo(0.6, 5);
    expect(position.holdMinutes).toBeCloseTo(12, 5);
    expect(position.ladderedExit).toBe(false);
    expect(position.reEntered).toBe(false);
  });

  it('treats a partial sell as PARTIALLY_CLOSED with no PnL claim', () => {
    const positions = buildPositions([
      swap({ direction: 'BUY', tokenAmount: 1000, solAmount: 1.5 }),
      swap({ direction: 'SELL', tokenAmount: 400, solAmount: 1.0, blockTime: minutes(5) }),
    ]);
    expect(positions[0]!.status).toBe('PARTIALLY_CLOSED');
    expect(positions[0]!.realizedPnlSol).toBeNull();
    expect(positions[0]!.holdMinutes).toBeNull();
  });

  it('reports OPEN and SELL_ONLY positions without inventing a cost basis', () => {
    const positions = buildPositions([
      swap({ mint: 'OpenMint', direction: 'BUY' }),
      swap({ mint: 'PreWindowMint', direction: 'SELL', blockTime: minutes(2) }),
    ]);
    const open = positions.find((p) => p.mint === 'OpenMint')!;
    const sellOnly = positions.find((p) => p.mint === 'PreWindowMint')!;
    expect(open.status).toBe('OPEN');
    expect(open.realizedPnlSol).toBeNull();
    expect(sellOnly.status).toBe('SELL_ONLY');
    expect(sellOnly.realizedPnlSol).toBeNull();
  });

  it('flags laddered exits and re-entries', () => {
    const positions = buildPositions([
      swap({ direction: 'BUY', tokenAmount: 1000, solAmount: 1, blockTime: minutes(0) }),
      swap({ direction: 'SELL', tokenAmount: 500, solAmount: 0.7, blockTime: minutes(3) }),
      swap({ direction: 'BUY', tokenAmount: 200, solAmount: 0.2, blockTime: minutes(6) }),
      swap({ direction: 'SELL', tokenAmount: 700, solAmount: 1.1, blockTime: minutes(9) }),
    ]);
    expect(positions[0]!.ladderedExit).toBe(true);
    expect(positions[0]!.reEntered).toBe(true);
    expect(positions[0]!.status).toBe('CLOSED');
    expect(positions[0]!.realizedPnlSol).toBeCloseTo(0.6, 5);
  });

  it('excludes PnL when any swap leg lacks an observed SOL amount', () => {
    const positions = buildPositions([
      swap({ direction: 'BUY', tokenAmount: 1000, solAmount: null }),
      swap({ direction: 'SELL', tokenAmount: 1000, solAmount: 2, blockTime: minutes(4) }),
    ]);
    expect(positions[0]!.status).toBe('CLOSED');
    expect(positions[0]!.realizedPnlSol).toBeNull();
  });
});

describe('summarize + strategy profile', () => {
  it('computes win rate over closed positions only', () => {
    const swaps = [
      swap({ mint: 'A', direction: 'BUY', solAmount: 1, blockTime: minutes(0) }),
      swap({ mint: 'A', direction: 'SELL', solAmount: 2, blockTime: minutes(10) }),
      swap({ mint: 'B', direction: 'BUY', solAmount: 1, blockTime: minutes(20) }),
      swap({ mint: 'B', direction: 'SELL', solAmount: 0.5, blockTime: minutes(25) }),
      swap({ mint: 'C', direction: 'BUY', solAmount: 1, blockTime: minutes(30) }),
    ];
    const positions = buildPositions(swaps);
    const summary = summarize(swaps, positions);
    expect(summary.closedPositions).toBe(2);
    expect(summary.winRate).toBeCloseTo(0.5, 5);
    expect(summary.realizedPnlSol).toBeCloseTo(0.5, 5);
    expect(summary.uniqueTokens).toBe(3);
  });

  it('derives an evidence-backed profile from the synthetic fixture day', () => {
    const fixtureSwaps = buildWalletTradeFixtures(T0);
    const report = analyzeWalletActivity(batchOf(fixtureSwaps));

    expect(report.summary.uniqueTokens).toBe(7);
    expect(report.summary.closedPositions).toBe(6);
    expect(report.summary.realizedPnlSol).toBeCloseTo(3.4, 5);
    expect(report.summary.winRate).toBeCloseTo(4 / 6, 3);

    expect(report.profile.holdStyle).toBe('SCALP');
    expect(report.profile.sizingStyle).toBe('FIXED_SIZE');
    expect(report.profile.exitStyle).toBe('SINGLE_EXIT');
    // Synthetic data must never present as a verified strategy read.
    expect(report.profile.confidence).toBe('UNVERIFIED');
    expect(report.profile.rules.length).toBeGreaterThan(0);
    expect(report.profile.caveats.length).toBeGreaterThan(0);
    for (const trait of report.profile.traits) {
      expect(trait.evidence.length).toBeGreaterThan(0);
    }
  });

  it('flags incomplete data in the profile caveats', () => {
    const batch = { ...batchOf([swap({})]), complete: false, unparsedTransactions: 2 };
    const report = analyzeWalletActivity(batch);
    expect(report.profile.caveats.some((c) => c.includes('incomplete'))).toBe(true);
    expect(report.profile.caveats.some((c) => c.includes('2 transaction'))).toBe(true);
  });
});

describe('parseSwap (RPC transaction parsing)', () => {
  const WALLET = 'Wallet11111111111111111111111111111111111111';
  const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

  const tokenBalance = (mint: string, uiAmount: number, owner = WALLET) => ({
    mint,
    owner,
    uiTokenAmount: { uiAmount, amount: String(uiAmount), decimals: 6 },
  });

  const tx = (overrides: {
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: ReturnType<typeof tokenBalance>[];
    postTokenBalances?: ReturnType<typeof tokenBalance>[];
    accountKeys?: Array<{ pubkey: string }>;
  }) => ({
    blockTime: Math.floor(T0.getTime() / 1000),
    meta: {
      err: null as unknown,
      preBalances: overrides.preBalances,
      postBalances: overrides.postBalances,
      preTokenBalances: overrides.preTokenBalances ?? [],
      postTokenBalances: overrides.postTokenBalances ?? [],
    },
    transaction: {
      message: { accountKeys: overrides.accountKeys ?? [{ pubkey: WALLET }, { pubkey: PUMP }] },
    },
  });

  it('classifies SOL out + token in as a BUY with the venue identified', () => {
    const result = parseSwap(
      tx({
        preBalances: [10_000_000_000, 0],
        postBalances: [8_400_000_000, 0],
        postTokenBalances: [tokenBalance('MemeMint', 50_000)],
      }),
      WALLET,
      'sig1',
    );
    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]!.direction).toBe('BUY');
    expect(result.swaps[0]!.solAmount).toBeCloseTo(1.6, 5);
    expect(result.swaps[0]!.tokenAmount).toBe(50_000);
    expect(result.swaps[0]!.venue).toBe('pump.fun');
  });

  it('classifies token out + SOL in as a SELL', () => {
    const result = parseSwap(
      tx({
        preBalances: [5_000_000_000, 0],
        postBalances: [5_900_000_000, 0],
        preTokenBalances: [tokenBalance('MemeMint', 50_000)],
        postTokenBalances: [tokenBalance('MemeMint', 0)],
      }),
      WALLET,
      'sig2',
    );
    expect(result.swaps[0]!.direction).toBe('SELL');
    expect(result.swaps[0]!.solAmount).toBeCloseTo(0.9, 5);
  });

  it('folds wrapped-SOL movement into the SOL leg', () => {
    const result = parseSwap(
      tx({
        preBalances: [5_000_000_000, 0],
        postBalances: [4_999_995_000, 0], // fee only
        preTokenBalances: [tokenBalance(SOL_MINT, 1.2)],
        postTokenBalances: [tokenBalance(SOL_MINT, 0), tokenBalance('MemeMint', 9_000)],
      }),
      WALLET,
      'sig3',
    );
    expect(result.swaps[0]!.direction).toBe('BUY');
    expect(result.swaps[0]!.solAmount).toBeCloseTo(1.2, 3);
  });

  it('ignores plain token transfers (no opposite SOL flow)', () => {
    const result = parseSwap(
      tx({
        preBalances: [5_000_000_000, 0],
        postBalances: [4_999_995_000, 0],
        preTokenBalances: [tokenBalance('MemeMint', 50_000)],
        postTokenBalances: [tokenBalance('MemeMint', 20_000)],
      }),
      WALLET,
      'sig4',
    );
    expect(result.swaps).toHaveLength(0);
    expect(result.unparsed).toBe(false);
  });

  it('records token-to-token routes as two unpriced legs', () => {
    const result = parseSwap(
      tx({
        preBalances: [5_000_000_000, 0],
        postBalances: [4_999_995_000, 0],
        preTokenBalances: [tokenBalance('MintA', 1_000)],
        postTokenBalances: [tokenBalance('MintA', 0), tokenBalance('MintB', 777)],
      }),
      WALLET,
      'sig5',
    );
    expect(result.swaps).toHaveLength(2);
    expect(result.swaps.every((s) => s.solAmount === null)).toBe(true);
    const directions = result.swaps.map((s) => s.direction).sort();
    expect(directions).toEqual(['BUY', 'SELL']);
  });

  it('skips failed transactions and transactions not involving the wallet', () => {
    const failed = tx({
      preBalances: [1, 0],
      postBalances: [1, 0],
    });
    failed.meta.err = { InstructionError: [0, 'Custom'] };
    expect(parseSwap(failed, WALLET, 'sig6').swaps).toHaveLength(0);

    const other = parseSwap(
      tx({
        preBalances: [10_000_000_000, 0],
        postBalances: [8_400_000_000, 0],
        postTokenBalances: [tokenBalance('MemeMint', 50_000)],
      }),
      'SomeOtherWallet1111111111111111111111111111',
      'sig7',
    );
    expect(other.swaps).toHaveLength(0);
  });
});
