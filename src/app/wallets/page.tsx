'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { EmptyState, Panel, StatTile } from '@/components/primitives';
import { formatDate, titleCase, UNKNOWN } from '@/lib/format';

/** Serialized (JSON) shapes of the wallet-scan report — dates arrive as ISO strings. */
interface SwapRow {
  signature: string;
  blockTime: string;
  direction: 'BUY' | 'SELL';
  mint: string;
  tokenSymbol: string | null;
  tokenAmount: number;
  solAmount: number | null;
  venue: string | null;
  source: string;
  confidence: string;
}

interface PositionRow {
  mint: string;
  tokenSymbol: string | null;
  buys: number;
  sells: number;
  solIn: number;
  solOut: number;
  firstBuyAt: string | null;
  holdMinutes: number | null;
  status: string;
  realizedPnlSol: number | null;
  ladderedExit: boolean;
  reEntered: boolean;
}

interface ScanResponse {
  provider?: { name: string; mode: string };
  report?: {
    address: string;
    windowStart: string;
    windowEnd: string;
    generatedAt: string;
    summary: {
      totalSwaps: number;
      uniqueTokens: number;
      totalBuys: number;
      totalSells: number;
      solSpent: number;
      solReceived: number;
      realizedPnlSol: number | null;
      closedPositions: number;
      winningClosedPositions: number;
      winRate: number | null;
      medianHoldMinutes: number | null;
      medianBuySizeSol: number | null;
      buySizeVariation: number | null;
      activeHoursUtc: number[];
    };
    positions: PositionRow[];
    profile: {
      holdStyle: string;
      sizingStyle: string;
      exitStyle: string;
      traits: Array<{ key: string; label: string; value: string; evidence: string }>;
      rules: string[];
      caveats: string[];
      confidence: string;
    };
    swaps: SwapRow[];
    unparsedTransactions: number;
    dataComplete: boolean;
    dataNote?: string;
  };
  error?: string;
  detail?: string;
}

const DEFAULT_ADDRESS = 'CuDe51GPh5qGsmYBJDxSsufhQQhA618uDbkaXFZ4pztL';

const sol = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined || Number.isNaN(value)
    ? UNKNOWN
    : `${value.toFixed(digits)} SOL`;

const signedSol = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? UNKNOWN
    : `${value > 0 ? '+' : ''}${value.toFixed(2)} SOL`;

const shortMint = (mint: string): string => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export default function WalletsPage(): ReactNode {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/wallets/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: address.trim(), date }),
      });
      const body = (await response.json()) as ScanResponse;
      if (!response.ok) {
        setError(
          response.status === 429
            ? `Rate limited. ${body.detail ?? 'Try again shortly.'}`
            : `${body.error ?? 'Scan failed'}${body.detail ? `: ${body.detail}` : ''}`,
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

  const report = result?.report;
  const summary = report?.summary;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink">Wallet scanner</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Reads a Solana wallet&apos;s token swaps for one UTC day, pairs them into positions,
          and distils the observable trading pattern into rules you can adapt. Realized PnL is
          computed only from round trips completed inside the window — nothing is priced by
          guesswork.
        </p>
      </header>

      <Panel title="Scan a wallet">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              Wallet address
            </span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              spellCheck={false}
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint"
              placeholder="Solana wallet address"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-wider text-ink-faint uppercase">
              UTC day
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-hairline-strong bg-panel px-3 py-2 text-sm text-ink"
            />
          </label>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded border border-accent/50 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {loading ? 'Scanning…' : 'Scan trades'}
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
        <Panel title="Scanning">
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton h-24 rounded" />
            ))}
          </div>
        </Panel>
      ) : null}

      {report && summary ? (
        <>
          {result?.provider?.mode === 'fixture' ? (
            <p className="rounded border border-caution/40 bg-caution/5 px-3 py-2 text-xs text-caution">
              These are bundled synthetic demo trades, NOT this wallet&apos;s real activity.
              Set SOLANA_RPC_URL and DATA_MODE=live to scan the chain.
            </p>
          ) : null}
          {report.dataNote ? (
            <p className="rounded border border-caution/40 bg-caution/5 px-3 py-2 text-xs text-caution">
              {report.dataNote}
            </p>
          ) : null}

          <Panel
            title="Day summary"
            subtitle={`${report.address.slice(0, 8)}… · ${formatDate(report.windowStart)} → ${formatDate(report.windowEnd)}`}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Swaps" value={String(summary.totalSwaps)} />
              <StatTile label="Tokens traded" value={String(summary.uniqueTokens)} />
              <StatTile label="SOL spent" value={sol(summary.solSpent)} />
              <StatTile label="SOL received" value={sol(summary.solReceived)} />
              <StatTile
                label="Realized PnL"
                value={signedSol(summary.realizedPnlSol)}
                hint={`${summary.closedPositions} closed round trip(s)`}
                tone={
                  summary.realizedPnlSol === null
                    ? 'default'
                    : summary.realizedPnlSol > 0
                      ? 'good'
                      : 'bad'
                }
              />
              <StatTile
                label="Win rate"
                value={
                  summary.winRate === null ? UNKNOWN : `${Math.round(summary.winRate * 100)}%`
                }
                hint={
                  summary.winRate === null
                    ? 'no closed round trips'
                    : `${summary.winningClosedPositions}/${summary.closedPositions} closed`
                }
              />
            </div>
          </Panel>

          <Panel
            title="Strategy read"
            subtitle={`Confidence: ${report.profile.confidence} · derived from this window only`}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                  Observed traits
                </h3>
                <ul className="space-y-2">
                  {report.profile.traits.map((trait) => (
                    <li key={trait.key} className="rounded border border-hairline bg-panel/50 p-3">
                      <p className="text-xs font-semibold text-ink">
                        {trait.label}: <span className="font-normal">{trait.value}</span>
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">
                        Evidence: {trait.evidence}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                    Rules to copy
                  </h3>
                  {report.profile.rules.length > 0 ? (
                    <ol className="list-decimal space-y-1.5 pl-5 text-xs text-ink-muted">
                      {report.profile.rules.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-ink-faint">
                      Not enough completed trades in this window to derive rules.
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                    What this scan cannot know
                  </h3>
                  <ul className="list-disc space-y-1.5 pl-5 text-[11px] text-ink-faint">
                    {report.profile.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Positions" subtitle="One row per token traded in the window">
            {report.positions.length === 0 ? (
              <EmptyState
                title="No swaps found"
                detail="This wallet made no parseable token swaps in the selected window."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-hairline text-[10px] tracking-wider text-ink-faint uppercase">
                      <th className="py-1.5 pr-3 font-medium">Token</th>
                      <th className="py-1.5 pr-3 font-medium">First buy</th>
                      <th className="py-1.5 pr-3 font-medium">Buys/Sells</th>
                      <th className="py-1.5 pr-3 font-medium">SOL in → out</th>
                      <th className="py-1.5 pr-3 font-medium">Hold</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 font-medium">Realized PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {report.positions.map((position) => (
                      <tr key={position.mint}>
                        <td className="py-1.5 pr-3 font-mono text-ink">
                          {position.tokenSymbol ?? shortMint(position.mint)}
                          {position.reEntered ? (
                            <span className="ml-1.5 text-[10px] text-caution">re-entry</span>
                          ) : null}
                          {position.ladderedExit ? (
                            <span className="ml-1.5 text-[10px] text-ink-faint">laddered</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">
                          {formatDate(position.firstBuyAt)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink-muted tnum">
                          {position.buys}/{position.sells}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink tnum">
                          {position.solIn.toFixed(2)} → {position.solOut.toFixed(2)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink-muted tnum">
                          {position.holdMinutes === null ? UNKNOWN : `${position.holdMinutes}m`}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">
                          {titleCase(position.status)}
                        </td>
                        <td
                          className={`py-1.5 font-mono tnum ${
                            position.realizedPnlSol === null
                              ? 'text-ink-faint'
                              : position.realizedPnlSol > 0
                                ? 'text-clean'
                                : 'text-occupied'
                          }`}
                        >
                          {signedSol(position.realizedPnlSol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Swaps"
            subtitle={`${report.swaps.length} parsed swap(s)${report.unparsedTransactions > 0 ? ` · ${report.unparsedTransactions} unparsed transaction(s) not shown` : ''}`}
          >
            {report.swaps.length === 0 ? (
              <EmptyState title="No swaps" detail="Nothing parseable in this window." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-hairline text-[10px] tracking-wider text-ink-faint uppercase">
                      <th className="py-1.5 pr-3 font-medium">Time (UTC)</th>
                      <th className="py-1.5 pr-3 font-medium">Side</th>
                      <th className="py-1.5 pr-3 font-medium">Token</th>
                      <th className="py-1.5 pr-3 font-medium">SOL</th>
                      <th className="py-1.5 pr-3 font-medium">Venue</th>
                      <th className="py-1.5 font-medium">Signature</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {report.swaps.map((swap, index) => (
                      <tr key={`${swap.signature}-${swap.mint}-${index}`}>
                        <td className="py-1.5 pr-3 font-mono text-ink-muted tnum">
                          {formatDate(swap.blockTime).slice(11)}
                        </td>
                        <td
                          className={`py-1.5 pr-3 font-semibold ${
                            swap.direction === 'BUY' ? 'text-clean' : 'text-occupied'
                          }`}
                        >
                          {swap.direction}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink">
                          {swap.tokenSymbol ?? shortMint(swap.mint)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-ink tnum">
                          {swap.solAmount === null ? UNKNOWN : swap.solAmount.toFixed(3)}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{swap.venue ?? UNKNOWN}</td>
                        <td className="py-1.5 font-mono text-[10px] text-ink-faint">
                          {swap.signature.startsWith('SYNTHETIC') ? (
                            swap.signature
                          ) : (
                            <a
                              href={`https://solscan.io/tx/${swap.signature}`}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="text-accent hover:underline"
                            >
                              {swap.signature.slice(0, 8)}…
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
