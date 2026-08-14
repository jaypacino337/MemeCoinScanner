import type {
  DiscoveredPost,
  DiscoveryFilters,
  Platform,
  TokenIndexQuery,
  TokenIndexResponse,
} from '@/lib/domain/types';

/**
 * Provider contracts.
 *
 * Every integration is behind one of these two interfaces so TikTok, Instagram,
 * X, and the token index can each be swapped out without touching the pipeline.
 */

export type ProviderMode = 'fixture' | 'http';

export interface ProviderHealth {
  key: string;
  state: 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'CREDENTIALS_MISSING' | 'DOWN';
  detail: string;
  /** Which env var(s) would be needed to move this provider to live data. */
  requiresCredential: string | null;
  checkedAt: Date;
}

export interface PlatformProvider {
  readonly platform: Platform;
  readonly name: string;
  readonly mode: ProviderMode;
  /** Env var required for live mode; null when the provider needs none. */
  readonly requiresCredential: string | null;

  /** Returns posts matching the filters. Must not invent metrics. */
  discover(filters: DiscoveryFilters): Promise<DiscoveredPost[]>;

  /** Re-reads current counters for one known post. Null when unavailable. */
  refresh(platformPostId: string): Promise<DiscoveredPost | null>;

  health(): Promise<ProviderHealth>;
}

export interface TokenIndexProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  readonly requiresCredential: string | null;

  search(query: TokenIndexQuery): Promise<TokenIndexResponse>;
  health(): Promise<ProviderHealth>;
}

/** Thrown when a live adapter is selected but its credential is absent. */
export class MissingCredentialError extends Error {
  constructor(
    public readonly provider: string,
    public readonly variable: string,
  ) {
    super(`${provider} requires ${variable} to be set for live mode`);
    this.name = 'MissingCredentialError';
  }
}

/** Thrown when an upstream signals a rate limit; surfaced to the health page. */
export class ProviderRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    public readonly resetAt: Date | null,
  ) {
    super(`${provider} rate limit reached`);
    this.name = 'ProviderRateLimitError';
  }
}
