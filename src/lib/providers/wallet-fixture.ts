import type { WalletSwapBatch } from '@/lib/domain/wallet';
import { buildWalletTradeFixtures } from '@/lib/fixtures/wallet-trades';
import type { ProviderHealth, WalletActivityProvider } from './types';

/**
 * Offline wallet-activity provider. Serves a deterministic synthetic trading
 * day so the scanner UI and analysis are demoable without RPC access — and
 * says so on every response.
 */
export class FixtureWalletActivityProvider implements WalletActivityProvider {
  readonly name = 'wallet-fixture';
  readonly mode = 'fixture' as const;
  readonly requiresCredential = 'SOLANA_RPC_URL';

  constructor(private readonly now: () => Date = () => new Date()) {}

  async fetchSwaps(address: string, windowStart: Date, windowEnd: Date): Promise<WalletSwapBatch> {
    const swaps = buildWalletTradeFixtures(windowStart).filter(
      (s) => s.blockTime >= windowStart && s.blockTime <= windowEnd,
    );
    return {
      address,
      windowStart,
      windowEnd,
      swaps,
      unparsedTransactions: 0,
      fetchedAt: this.now(),
      complete: true,
      note: 'Synthetic demo trades — NOT this wallet’s real on-chain activity. Set SOLANA_RPC_URL and DATA_MODE=live to scan the chain.',
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      key: this.name,
      state: 'CREDENTIALS_MISSING',
      detail:
        'Wallet scans serve synthetic demo trades. Set SOLANA_RPC_URL to read real on-chain swaps.',
      requiresCredential: this.requiresCredential,
      checkedAt: this.now(),
    };
  }
}
