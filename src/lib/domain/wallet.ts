import type { ConfidenceLevel, MetricSource } from './types';

/**
 * Wallet-scanner domain types.
 *
 * Everything here follows the same principle as the rest of the app: a number
 * on screen must correspond to an observation that actually exists. A swap is
 * an observed on-chain transaction; realized PnL is only computed where the
 * cost basis was actually observed inside the scanned window; anything the
 * scan could not establish is null and labelled, never guessed.
 */

/** The wallets this radar tracks. The first entry was supplied by the user. */
export const TRACKED_WALLETS: Array<{ address: string; label: string; addedAt: string }> = [
  {
    address: 'CuDe51GPh5qGsmYBJDxSsufhQQhA618uDbkaXFZ4pztL',
    label: 'Target wallet #1',
    addedAt: '2026-09-19',
  },
];

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export type SwapDirection = 'BUY' | 'SELL';

/** One observed token swap by the scanned wallet. */
export interface WalletSwap {
  signature: string;
  blockTime: Date;
  direction: SwapDirection;
  /** The non-SOL side of the swap. */
  mint: string;
  tokenSymbol: string | null;
  tokenAmount: number;
  /**
   * SOL leg of the swap: spent on a BUY, received on a SELL. Null when the
   * transaction had no measurable SOL leg (e.g. token-to-token routes) — such
   * swaps are listed but excluded from PnL rather than priced by guesswork.
   */
  solAmount: number | null;
  /** Identified DEX/program label when recognisable, else null. */
  venue: string | null;
  source: MetricSource;
  confidence: ConfidenceLevel;
}

/** What a wallet-activity provider returns for one scan window. */
export interface WalletSwapBatch {
  address: string;
  windowStart: Date;
  windowEnd: Date;
  swaps: WalletSwap[];
  /** Transactions in the window that touched tokens but could not be parsed as swaps. */
  unparsedTransactions: number;
  fetchedAt: Date;
  /** False when history may be truncated (pagination/RPC limits) — never silently. */
  complete: boolean;
  note?: string;
}

export type PositionStatus = 'CLOSED' | 'PARTIALLY_CLOSED' | 'OPEN' | 'SELL_ONLY';

/** All activity in one token, aggregated from the swaps in the window. */
export interface TokenPosition {
  mint: string;
  tokenSymbol: string | null;
  buys: number;
  sells: number;
  solIn: number;
  solOut: number;
  firstBuyAt: Date | null;
  lastSellAt: Date | null;
  /** Minutes from first buy to last sell; null while the position is open. */
  holdMinutes: number | null;
  status: PositionStatus;
  /**
   * SOL received minus SOL spent, only when every leg was observed in-window
   * (status CLOSED). Open or sell-only positions report null — the scan does
   * not know current prices or pre-window cost bases.
   */
  realizedPnlSol: number | null;
  /** True when sells happened in more than one transaction (laddered exit). */
  ladderedExit: boolean;
  /** True when the wallet bought again after having sold (re-entry). */
  reEntered: boolean;
}

export type HoldStyle = 'FLASH_SCALP' | 'SCALP' | 'INTRADAY' | 'SWING' | 'UNKNOWN';
export type SizingStyle = 'FIXED_SIZE' | 'VARIABLE_SIZE' | 'UNKNOWN';
export type ExitStyle = 'SINGLE_EXIT' | 'LADDERED_EXIT' | 'MIXED' | 'UNKNOWN';

export interface StrategyTrait {
  key: string;
  label: string;
  value: string;
  /** The observed numbers this trait was derived from. */
  evidence: string;
}

/** The distilled, copyable read of how the wallet traded in the window. */
export interface StrategyProfile {
  holdStyle: HoldStyle;
  sizingStyle: SizingStyle;
  exitStyle: ExitStyle;
  traits: StrategyTrait[];
  /** Actionable rules for mirroring the behaviour, phrased from evidence only. */
  rules: string[];
  /** What this scan cannot know; always shown next to the rules. */
  caveats: string[];
  confidence: ConfidenceLevel;
}

export interface WalletScanSummary {
  totalSwaps: number;
  uniqueTokens: number;
  totalBuys: number;
  totalSells: number;
  solSpent: number;
  solReceived: number;
  /** Sum over CLOSED positions only. */
  realizedPnlSol: number | null;
  closedPositions: number;
  winningClosedPositions: number;
  /** Wins / closed positions; null with no closed positions. */
  winRate: number | null;
  medianHoldMinutes: number | null;
  medianBuySizeSol: number | null;
  /** Coefficient of variation of buy sizes; low = consistent sizing. */
  buySizeVariation: number | null;
  /** UTC hours (0-23) ranked by swap count, busiest first. */
  activeHoursUtc: number[];
}

export interface WalletScanReport {
  address: string;
  windowStart: Date;
  windowEnd: Date;
  generatedAt: Date;
  summary: WalletScanSummary;
  positions: TokenPosition[];
  profile: StrategyProfile;
  swaps: WalletSwap[];
  unparsedTransactions: number;
  dataComplete: boolean;
  dataNote?: string;
}
