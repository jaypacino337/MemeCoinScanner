import type {
  ExitStyle,
  HoldStyle,
  SizingStyle,
  StrategyProfile,
  StrategyTrait,
  TokenPosition,
  WalletScanReport,
  WalletScanSummary,
  WalletSwap,
  WalletSwapBatch,
} from '@/lib/domain/wallet';

/**
 * Wallet strategy analysis — pure logic, no storage, no network.
 *
 * Turns a batch of observed swaps into positions, a summary, and a strategy
 * profile. Two rules keep this honest:
 *
 *  1. Realized PnL exists only for positions whose full round trip (every buy
 *     and every sell) was observed inside the window. A sell of tokens bought
 *     before the window has no observed cost basis and reports null, not a
 *     flattering or damning guess.
 *  2. Every trait in the profile cites the numbers it was derived from, and
 *     the caveats list what the scan cannot know (unrealized PnL, pre-window
 *     history, whether the day was typical).
 */

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (sorted.length % 2 === 0 && low !== undefined && high !== undefined) {
    return (low + high) / 2;
  }
  return high ?? null;
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

const round = (value: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export function buildPositions(swaps: WalletSwap[]): TokenPosition[] {
  const byMint = new Map<string, WalletSwap[]>();
  for (const swap of swaps) {
    const list = byMint.get(swap.mint) ?? [];
    list.push(swap);
    byMint.set(swap.mint, list);
  }

  const positions: TokenPosition[] = [];
  for (const [mint, mintSwaps] of byMint) {
    const ordered = [...mintSwaps].sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
    const buys = ordered.filter((s) => s.direction === 'BUY');
    const sells = ordered.filter((s) => s.direction === 'SELL');

    const solIn = buys.reduce((a, s) => a + (s.solAmount ?? 0), 0);
    const solOut = sells.reduce((a, s) => a + (s.solAmount ?? 0), 0);
    const solLegsComplete = ordered.every((s) => s.solAmount !== null);

    const boughtTokens = buys.reduce((a, s) => a + s.tokenAmount, 0);
    const soldTokens = sells.reduce((a, s) => a + s.tokenAmount, 0);
    // Tolerate rounding/fee dust: a position counts as closed when ≥99% of the
    // tokens bought in-window were sold in-window.
    const closed = buys.length > 0 && sells.length > 0 && soldTokens >= boughtTokens * 0.99;

    const status =
      buys.length === 0
        ? 'SELL_ONLY'
        : sells.length === 0
          ? 'OPEN'
          : closed
            ? 'CLOSED'
            : 'PARTIALLY_CLOSED';

    const firstBuyAt = buys[0]?.blockTime ?? null;
    const lastSellAt = sells[sells.length - 1]?.blockTime ?? null;

    // A re-entry is any buy that happens after a sell of the same token.
    let reEntered = false;
    let seenSell = false;
    for (const swap of ordered) {
      if (swap.direction === 'SELL') seenSell = true;
      else if (seenSell) {
        reEntered = true;
        break;
      }
    }

    positions.push({
      mint,
      tokenSymbol: ordered.find((s) => s.tokenSymbol)?.tokenSymbol ?? null,
      buys: buys.length,
      sells: sells.length,
      solIn: round(solIn),
      solOut: round(solOut),
      firstBuyAt,
      lastSellAt,
      holdMinutes:
        status === 'CLOSED' && firstBuyAt && lastSellAt
          ? round((lastSellAt.getTime() - firstBuyAt.getTime()) / 60_000, 1)
          : null,
      status,
      realizedPnlSol: status === 'CLOSED' && solLegsComplete ? round(solOut - solIn) : null,
      ladderedExit: sells.length > 1,
      reEntered,
    });
  }

  return positions.sort(
    (a, b) => (a.firstBuyAt?.getTime() ?? 0) - (b.firstBuyAt?.getTime() ?? 0),
  );
}

export function summarize(swaps: WalletSwap[], positions: TokenPosition[]): WalletScanSummary {
  const buys = swaps.filter((s) => s.direction === 'BUY');
  const sells = swaps.filter((s) => s.direction === 'SELL');

  const closed = positions.filter((p) => p.realizedPnlSol !== null);
  const wins = closed.filter((p) => (p.realizedPnlSol ?? 0) > 0);

  const buySizes = buys
    .map((s) => s.solAmount)
    .filter((v): v is number => v !== null && v > 0);

  const hourCounts = new Map<number, number>();
  for (const swap of swaps) {
    const hour = swap.blockTime.getUTCHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }

  return {
    totalSwaps: swaps.length,
    uniqueTokens: positions.length,
    totalBuys: buys.length,
    totalSells: sells.length,
    solSpent: round(buys.reduce((a, s) => a + (s.solAmount ?? 0), 0)),
    solReceived: round(sells.reduce((a, s) => a + (s.solAmount ?? 0), 0)),
    realizedPnlSol:
      closed.length > 0 ? round(closed.reduce((a, p) => a + (p.realizedPnlSol ?? 0), 0)) : null,
    closedPositions: closed.length,
    winningClosedPositions: wins.length,
    winRate: closed.length > 0 ? round(wins.length / closed.length, 3) : null,
    medianHoldMinutes: median(
      positions.map((p) => p.holdMinutes).filter((v): v is number => v !== null),
    ),
    medianBuySizeSol: (() => {
      const m = median(buySizes);
      return m === null ? null : round(m);
    })(),
    buySizeVariation: (() => {
      const cv = coefficientOfVariation(buySizes);
      return cv === null ? null : round(cv);
    })(),
    activeHoursUtc: [...hourCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([hour]) => hour),
  };
}

function classifyHoldStyle(medianHoldMinutes: number | null): HoldStyle {
  if (medianHoldMinutes === null) return 'UNKNOWN';
  if (medianHoldMinutes < 5) return 'FLASH_SCALP';
  if (medianHoldMinutes < 30) return 'SCALP';
  if (medianHoldMinutes < 360) return 'INTRADAY';
  return 'SWING';
}

const HOLD_STYLE_LABEL: Record<HoldStyle, string> = {
  FLASH_SCALP: 'flash scalps (in and out inside ~5 minutes)',
  SCALP: 'quick scalps (minutes, not hours)',
  INTRADAY: 'intraday positions (held under ~6 hours)',
  SWING: 'swing positions (held 6+ hours)',
  UNKNOWN: 'hold style could not be established',
};

export function buildStrategyProfile(
  summary: WalletScanSummary,
  positions: TokenPosition[],
  batch: Pick<WalletSwapBatch, 'complete' | 'unparsedTransactions' | 'swaps'>,
): StrategyProfile {
  const traits: StrategyTrait[] = [];
  const rules: string[] = [];
  const caveats: string[] = [];

  const holdStyle = classifyHoldStyle(summary.medianHoldMinutes);
  if (summary.medianHoldMinutes !== null) {
    traits.push({
      key: 'hold-style',
      label: 'Hold style',
      value: HOLD_STYLE_LABEL[holdStyle],
      evidence: `median completed hold ${summary.medianHoldMinutes.toFixed(1)} min over ${summary.closedPositions} closed position(s)`,
    });
    rules.push(
      `Plan exits on entry: this wallet's completed round trips have a median hold of ~${Math.round(summary.medianHoldMinutes)} minutes.`,
    );
  }

  let sizingStyle: SizingStyle = 'UNKNOWN';
  if (summary.buySizeVariation !== null && summary.medianBuySizeSol !== null) {
    sizingStyle = summary.buySizeVariation < 0.35 ? 'FIXED_SIZE' : 'VARIABLE_SIZE';
    traits.push({
      key: 'sizing',
      label: 'Position sizing',
      value:
        sizingStyle === 'FIXED_SIZE'
          ? `consistent, ~${summary.medianBuySizeSol} SOL per entry`
          : `variable, median ~${summary.medianBuySizeSol} SOL per entry`,
      evidence: `median buy ${summary.medianBuySizeSol} SOL, size variation coefficient ${summary.buySizeVariation}`,
    });
    rules.push(
      sizingStyle === 'FIXED_SIZE'
        ? `Use a fixed entry size (this wallet used ~${summary.medianBuySizeSol} SOL per position).`
        : `Size per conviction, but anchor near the wallet's median of ~${summary.medianBuySizeSol} SOL.`,
    );
  }

  const withSells = positions.filter((p) => p.sells > 0);
  const laddered = withSells.filter((p) => p.ladderedExit);
  let exitStyle: ExitStyle = 'UNKNOWN';
  if (withSells.length > 0) {
    const ratio = laddered.length / withSells.length;
    exitStyle = ratio >= 0.7 ? 'LADDERED_EXIT' : ratio <= 0.3 ? 'SINGLE_EXIT' : 'MIXED';
    traits.push({
      key: 'exit-style',
      label: 'Exit style',
      value:
        exitStyle === 'LADDERED_EXIT'
          ? 'sells in multiple tranches'
          : exitStyle === 'SINGLE_EXIT'
            ? 'dumps the full position in one transaction'
            : 'mixes single exits and laddered exits',
      evidence: `${laddered.length} of ${withSells.length} exited position(s) used more than one sell`,
    });
    rules.push(
      exitStyle === 'LADDERED_EXIT'
        ? 'Take profit in tranches rather than one exit.'
        : exitStyle === 'SINGLE_EXIT'
          ? 'Exit the full position at once when the exit condition hits.'
          : 'Default to a full exit, ladder only on runners.',
    );
  }

  const reEntries = positions.filter((p) => p.reEntered);
  traits.push({
    key: 're-entry',
    label: 'Re-entries',
    value:
      reEntries.length === 0
        ? 'does not return to a token after selling it'
        : `re-entered ${reEntries.length} token(s) after selling`,
    evidence: `${reEntries.length} of ${positions.length} token(s) bought again after a sell`,
  });
  if (reEntries.length === 0 && positions.length >= 3) {
    rules.push('One shot per token: once out, move to the next play instead of re-entering.');
  }

  if (summary.winRate !== null && summary.realizedPnlSol !== null) {
    traits.push({
      key: 'outcome',
      label: 'Observed outcome',
      value: `${summary.winningClosedPositions}/${summary.closedPositions} closed positions profitable, net ${summary.realizedPnlSol > 0 ? '+' : ''}${summary.realizedPnlSol} SOL realized`,
      evidence: `computed from full in-window round trips only (${summary.closedPositions} of ${summary.uniqueTokens} tokens)`,
    });
  }

  if (summary.activeHoursUtc.length > 0) {
    const top = summary.activeHoursUtc.slice(0, 3).sort((a, b) => a - b);
    traits.push({
      key: 'active-hours',
      label: 'Most active (UTC)',
      value: top.map((h) => `${String(h).padStart(2, '0')}:00`).join(', '),
      evidence: `hours ranked by swap count across ${summary.totalSwaps} swap(s)`,
    });
  }

  // Honesty block: what a one-window scan cannot establish.
  caveats.push(
    'Realized PnL covers only round trips completed inside the scanned window; open positions and tokens bought before the window are excluded, so the true day PnL can differ.',
  );
  caveats.push(
    'One window is a sample, not a strategy: confirm these patterns over several days before copying them.',
  );
  caveats.push('Past trades are not evidence future ones will perform. This is not financial advice.');
  if (!batch.complete) {
    caveats.push('The provider reported an incomplete swap history for this window.');
  }
  if (batch.unparsedTransactions > 0) {
    caveats.push(
      `${batch.unparsedTransactions} transaction(s) touched tokens but could not be parsed as swaps and are not counted.`,
    );
  }

  const fixtureData = batch.swaps.some((s) => s.source === 'SYNTHETIC_FIXTURE');
  const confidence = fixtureData
    ? 'UNVERIFIED'
    : !batch.complete || summary.closedPositions < 3
      ? 'LOW'
      : summary.closedPositions < 8
        ? 'MEDIUM'
        : 'HIGH';

  return { holdStyle, sizingStyle, exitStyle, traits, rules, caveats, confidence };
}

export function analyzeWalletActivity(batch: WalletSwapBatch, now = new Date()): WalletScanReport {
  const positions = buildPositions(batch.swaps);
  const summary = summarize(batch.swaps, positions);
  const profile = buildStrategyProfile(summary, positions, batch);

  return {
    address: batch.address,
    windowStart: batch.windowStart,
    windowEnd: batch.windowEnd,
    generatedAt: now,
    summary,
    positions,
    profile,
    swaps: [...batch.swaps].sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime()),
    unparsedTransactions: batch.unparsedTransactions,
    dataComplete: batch.complete,
    ...(batch.note ? { dataNote: batch.note } : {}),
  };
}
