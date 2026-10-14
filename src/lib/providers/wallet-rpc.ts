import { z } from 'zod';
import { SOL_MINT, type WalletSwap, type WalletSwapBatch } from '@/lib/domain/wallet';
import { childLogger } from '@/lib/infra/logger';
import { providerLimiter } from '@/lib/infra/rate-limit';
import type { ProviderHealth, WalletActivityProvider } from './types';

/**
 * Live wallet-activity provider over standard Solana JSON-RPC
 * (getSignaturesForAddress + getTransaction). Works against any RPC endpoint —
 * public mainnet, Helius, QuickNode, Triton — set via SOLANA_RPC_URL.
 *
 * Swap detection is balance-delta based, not program-specific: a transaction
 * counts as a swap when the wallet's holdings of exactly one non-SOL token
 * changed against an opposite SOL (or wrapped-SOL) flow. Anything the parser
 * cannot classify is counted in `unparsedTransactions` and reported — never
 * silently priced or dropped.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
/** SOL flows below this are treated as fee noise, not a swap leg. */
const SOL_DUST_THRESHOLD = 0.001;

/** Programs we can name for the "venue" column. Unknown programs stay null. */
const KNOWN_PROGRAMS: Record<string, string> = {
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'pump.fun-amm',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'jupiter',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'raydium',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'raydium-clmm',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'meteora-dlmm',
};

const signatureInfoSchema = z.object({
  signature: z.string(),
  blockTime: z.number().nullable(),
  err: z.unknown().nullable(),
});

const tokenBalanceSchema = z.object({
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({
    uiAmount: z.number().nullable(),
    amount: z.string(),
    decimals: z.number(),
  }),
});

const transactionSchema = z.object({
  blockTime: z.number().nullable(),
  meta: z
    .object({
      err: z.unknown().nullable(),
      preBalances: z.array(z.number()),
      postBalances: z.array(z.number()),
      preTokenBalances: z.array(tokenBalanceSchema).nullable().optional(),
      postTokenBalances: z.array(tokenBalanceSchema).nullable().optional(),
    })
    .nullable(),
  transaction: z.object({
    message: z.object({
      accountKeys: z.array(
        z.union([z.string(), z.object({ pubkey: z.string() })]),
      ),
    }),
  }),
});

type ParsedTransaction = z.infer<typeof transactionSchema>;

export interface SolanaRpcWalletOptions {
  rpcUrl: string | undefined;
  timeoutMs?: number;
  /** Hard cap on transactions inspected per scan; exceeding it flags `complete: false`. */
  maxTransactions?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

/** Wallet token deltas extracted from one transaction. Exported for tests. */
export function parseSwap(
  tx: ParsedTransaction,
  address: string,
  signature: string,
): { swaps: WalletSwap[]; unparsed: boolean } {
  const none = { swaps: [], unparsed: false };
  if (!tx.meta || tx.meta.err !== null || tx.blockTime === null) return none;

  const keys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey,
  );
  const walletIndex = keys.indexOf(address);
  if (walletIndex === -1) return none;

  let solDelta =
    ((tx.meta.postBalances[walletIndex] ?? 0) - (tx.meta.preBalances[walletIndex] ?? 0)) /
    LAMPORTS_PER_SOL;

  // Net token deltas for balances owned by the wallet.
  const deltas = new Map<string, number>();
  for (const balance of tx.meta.preTokenBalances ?? []) {
    if (balance.owner !== address) continue;
    deltas.set(balance.mint, (deltas.get(balance.mint) ?? 0) - (balance.uiTokenAmount.uiAmount ?? 0));
  }
  for (const balance of tx.meta.postTokenBalances ?? []) {
    if (balance.owner !== address) continue;
    deltas.set(balance.mint, (deltas.get(balance.mint) ?? 0) + (balance.uiTokenAmount.uiAmount ?? 0));
  }

  // Wrapped SOL moves are part of the SOL leg, not a token position.
  const wsolDelta = deltas.get(SOL_MINT);
  if (wsolDelta !== undefined) {
    solDelta += wsolDelta;
    deltas.delete(SOL_MINT);
  }

  const changed = [...deltas.entries()].filter(([, delta]) => Math.abs(delta) > 0);
  if (changed.length === 0) return none;

  const venue = keys.map((k) => KNOWN_PROGRAMS[k]).find((v) => v !== undefined) ?? null;
  const blockTime = new Date(tx.blockTime * 1000);

  const makeSwap = (
    mint: string,
    delta: number,
    solAmount: number | null,
  ): WalletSwap => ({
    signature,
    blockTime,
    direction: delta > 0 ? 'BUY' : 'SELL',
    mint,
    tokenSymbol: null, // plain RPC does not expose symbols; the UI shows the mint
    tokenAmount: Math.abs(delta),
    solAmount,
    venue,
    source: 'OFFICIAL_API',
    confidence: 'HIGH',
  });

  if (changed.length === 1) {
    const entry = changed[0];
    if (!entry) return none;
    const [mint, delta] = entry;
    const opposite = delta > 0 ? solDelta < 0 : solDelta > 0;
    if (!opposite || Math.abs(solDelta) < SOL_DUST_THRESHOLD) {
      // Token moved without an opposite SOL flow: a transfer/airdrop, not a trade.
      return none;
    }
    return { swaps: [makeSwap(mint, delta, Math.abs(solDelta))], unparsed: false };
  }

  if (changed.length === 2) {
    const first = changed[0];
    const second = changed[1];
    if (first && second && first[1] * second[1] < 0) {
      // Token-to-token route: both legs are recorded, but neither gets a SOL
      // price — pricing them would be an invention, so PnL math skips them.
      return {
        swaps: [
          makeSwap(first[0], first[1], null),
          makeSwap(second[0], second[1], null),
        ],
        unparsed: false,
      };
    }
  }

  return { swaps: [], unparsed: true };
}

export class SolanaRpcWalletProvider implements WalletActivityProvider {
  readonly name = 'wallet-solana-rpc';
  readonly mode = 'http' as const;
  readonly requiresCredential = 'SOLANA_RPC_URL';

  private readonly log = childLogger({ provider: 'wallet-solana-rpc' });
  private lastError: string | null = null;

  constructor(private readonly options: SolanaRpcWalletOptions) {}

  private get now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
    await providerLimiter.acquire(this.name);
    try {
      const doFetch = this.options.fetchImpl ?? fetch;
      const response = await doFetch(this.options.rpcUrl!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const body = (await response.json()) as { result?: T; error?: { message?: string } };
      if (body.error) throw new Error(`RPC error: ${body.error.message ?? 'unknown'}`);
      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchSwaps(address: string, windowStart: Date, windowEnd: Date): Promise<WalletSwapBatch> {
    const fetchedAt = this.now;
    const maxTransactions = this.options.maxTransactions ?? 1000;
    const startSecs = Math.floor(windowStart.getTime() / 1000);
    const endSecs = Math.floor(windowEnd.getTime() / 1000);

    const base: Omit<WalletSwapBatch, 'swaps' | 'complete' | 'note' | 'unparsedTransactions'> = {
      address,
      windowStart,
      windowEnd,
      fetchedAt,
    };

    if (!this.options.rpcUrl) {
      return {
        ...base,
        swaps: [],
        unparsedTransactions: 0,
        complete: false,
        note: 'SOLANA_RPC_URL is not configured, so no on-chain history was read.',
      };
    }

    try {
      // 1. Page signatures (newest first) back to the window start.
      const inWindow: string[] = [];
      let before: string | undefined;
      let truncated = false;

      paging: for (;;) {
        const page = await this.rpc<unknown[]>('getSignaturesForAddress', [
          address,
          { limit: 1000, ...(before ? { before } : {}) },
        ]);
        if (!Array.isArray(page) || page.length === 0) break;

        for (const raw of page) {
          const info = signatureInfoSchema.safeParse(raw);
          if (!info.success) continue;
          const { signature, blockTime, err } = info.data;
          if (blockTime !== null && blockTime < startSecs) break paging;
          if (blockTime !== null && blockTime <= endSecs && err === null) {
            inWindow.push(signature);
            if (inWindow.length >= maxTransactions) {
              truncated = true;
              break paging;
            }
          }
        }
        const last = page[page.length - 1];
        const lastInfo = signatureInfoSchema.safeParse(last);
        if (!lastInfo.success) break;
        before = lastInfo.data.signature;
        if (page.length < 1000) break;
      }

      // 2. Fetch and parse each transaction with modest concurrency.
      const swaps: WalletSwap[] = [];
      let unparsed = 0;
      let failedFetches = 0;
      const queue = [...inWindow];
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          const signature = queue.shift();
          if (!signature) return;
          try {
            const raw = await this.rpc<unknown>('getTransaction', [
              signature,
              { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
            ]);
            const parsed = transactionSchema.safeParse(raw);
            if (!parsed.success) {
              unparsed += 1;
              continue;
            }
            const result = parseSwap(parsed.data, address, signature);
            swaps.push(...result.swaps);
            if (result.unparsed) unparsed += 1;
          } catch (error) {
            failedFetches += 1;
            this.log.warn(
              { signature, err: error instanceof Error ? error.message : String(error) },
              'transaction fetch failed',
            );
          }
        }
      });
      await Promise.all(workers);

      this.lastError = null;
      const notes: string[] = [];
      if (truncated) {
        notes.push(`Stopped after ${maxTransactions} transactions; older activity in the window was not read.`);
      }
      if (failedFetches > 0) {
        notes.push(`${failedFetches} transaction(s) could not be fetched from the RPC.`);
      }

      return {
        ...base,
        swaps: swaps.sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime()),
        unparsedTransactions: unparsed,
        complete: !truncated && failedFetches === 0,
        ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log.error({ err: this.lastError }, 'wallet scan failed');
      return {
        ...base,
        swaps: [],
        unparsedTransactions: 0,
        complete: false,
        note: `RPC request failed: ${this.lastError}`,
      };
    }
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = this.now;
    if (!this.options.rpcUrl) {
      return {
        key: this.name,
        state: 'CREDENTIALS_MISSING',
        detail: 'SOLANA_RPC_URL is not set.',
        requiresCredential: this.requiresCredential,
        checkedAt,
      };
    }
    return {
      key: this.name,
      state: this.lastError ? 'DEGRADED' : 'HEALTHY',
      detail: this.lastError ?? 'Configured for live on-chain wallet scans.',
      requiresCredential: this.requiresCredential,
      checkedAt,
    };
  }
}
