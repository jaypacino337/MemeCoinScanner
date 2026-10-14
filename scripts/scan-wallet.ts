/**
 * CLI wallet scan: `npm run scan:wallet -- --address <pubkey> --date 2026-09-19`
 *
 * Defaults to the first tracked wallet and today (UTC). Add --json for the raw
 * report. Requires SOLANA_RPC_URL and DATA_MODE=live for real on-chain data;
 * otherwise it prints the labelled synthetic demo.
 */

// The wallet scan never touches the database, but env validation requires
// DATABASE_URL to exist — give it a placeholder when the caller has none.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { TRACKED_WALLETS } from '../src/lib/domain/wallet';
import { analyzeWalletActivity } from '../src/lib/pipeline/wallet-analysis';
import { buildRegistry } from '../src/lib/providers/registry';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const address = args.address ?? TRACKED_WALLETS[0]?.address;
  if (!address) throw new Error('No --address given and no tracked wallet configured');

  const now = new Date();
  const day = args.date ?? now.toISOString().slice(0, 10);
  const windowStart = new Date(`${day}T00:00:00.000Z`);
  const windowEndRaw = new Date(`${day}T23:59:59.999Z`);
  const windowEnd = windowEndRaw > now ? now : windowEndRaw;

  const registry = buildRegistry();
  const provider = registry.walletActivity;

  console.error(`scanning ${address} on ${day} via ${provider.name} (${provider.mode} mode)…`);
  const batch = await provider.fetchSwaps(address, windowStart, windowEnd);
  const report = analyzeWalletActivity(batch, now);

  if (args.json === 'true') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { summary, profile } = report;
  console.log(`\nWallet ${address} — ${day} (UTC)`);
  if (report.dataNote) console.log(`NOTE: ${report.dataNote}`);
  console.log(
    `  swaps ${summary.totalSwaps} · tokens ${summary.uniqueTokens} · spent ${summary.solSpent} SOL · received ${summary.solReceived} SOL`,
  );
  console.log(
    `  realized PnL ${summary.realizedPnlSol ?? 'n/a'} SOL over ${summary.closedPositions} closed round trip(s) · win rate ${
      summary.winRate === null ? 'n/a' : `${Math.round(summary.winRate * 100)}%`
    }`,
  );

  console.log('\nPositions:');
  for (const p of report.positions) {
    console.log(
      `  ${(p.tokenSymbol ?? p.mint.slice(0, 8)).padEnd(10)} ${String(p.buys).padStart(2)}B/${String(p.sells).padEnd(2)}S  in ${p.solIn.toFixed(2).padStart(7)}  out ${p.solOut.toFixed(2).padStart(7)}  hold ${
        p.holdMinutes === null ? '   n/a' : `${p.holdMinutes.toFixed(0).padStart(4)}m`
      }  ${p.status}${p.realizedPnlSol === null ? '' : `  PnL ${p.realizedPnlSol > 0 ? '+' : ''}${p.realizedPnlSol.toFixed(2)}`}`,
    );
  }

  console.log('\nStrategy read:');
  for (const trait of profile.traits) {
    console.log(`  ${trait.label}: ${trait.value}`);
    console.log(`    evidence: ${trait.evidence}`);
  }
  console.log('\nRules to copy:');
  for (const rule of profile.rules) console.log(`  - ${rule}`);
  console.log('\nCaveats:');
  for (const caveat of profile.caveats) console.log(`  - ${caveat}`);
  console.log(`\nConfidence: ${profile.confidence}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
