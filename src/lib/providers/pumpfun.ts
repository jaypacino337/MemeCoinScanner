import { z } from 'zod';
import type { IndexedToken, TokenIndexQuery, TokenIndexResponse } from '@/lib/domain/types';
import { buildTokenFixtures } from '@/lib/fixtures/tokens';
import { Cache, cacheKey } from '@/lib/infra/cache';
import { childLogger } from '@/lib/infra/logger';
import { providerLimiter } from '@/lib/infra/rate-limit';
import type { ProviderHealth, TokenIndexProvider } from './types';

/**
 * Token-index providers (Pump.fun screening).
 *
 * Two implementations:
 *  - FixtureTokenIndexProvider: offline, synthetic, always labelled.
 *  - HttpTokenIndexProvider: points at PUMPFUN_API_BASE_URL, which you set to
 *    whichever Pump.fun-compatible search/index endpoint you are permitted to
 *    query. Expected response contract is `tokenSearchResponseSchema`.
 *
 * Both are careful about one thing: when the index cannot be searched
 * completely, `complete` is false, which forces the screener to report
 * UNCERTAIN instead of CLEAN.
 */

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Builds the literal query strings we report back to the user. */
export function buildQueryStrings(query: TokenIndexQuery): string[] {
  const queries: string[] = [];
  if (query.ticker) queries.push(`ticker:${query.ticker}`);
  if (query.name) queries.push(`name:${query.name}`);
  if (query.subject) queries.push(`subject:${query.subject}`);
  if (query.postUrl) queries.push(`linkedPost:${query.postUrl}`);
  return queries;
}

export class FixtureTokenIndexProvider implements TokenIndexProvider {
  readonly name = 'pumpfun-fixture';
  readonly mode = 'fixture' as const;
  readonly requiresCredential = 'PUMPFUN_API_BASE_URL';

  constructor(private readonly now: () => Date = () => new Date()) {}

  async search(query: TokenIndexQuery): Promise<TokenIndexResponse> {
    const now = this.now();
    const all = buildTokenFixtures(now);

    const terms = [query.ticker, query.name, query.subject]
      .filter((t): t is string => Boolean(t))
      .map(canonical)
      .filter((t) => t.length >= 2);

    // Mirrors a real index search: return anything plausibly related and let
    // the screener decide what actually counts as a match.
    const tokens = all.filter((token) => {
      const haystack = [
        canonical(token.name),
        canonical(token.ticker),
        ...(token.subjectTags ?? []).map(canonical),
      ];
      return terms.some((term) =>
        haystack.some((h) => h.includes(term) || term.includes(h)),
      );
    });

    return {
      queries: buildQueryStrings(query),
      tokens,
      searchedAt: now,
      complete: true,
      note: 'Synthetic demo index — not a search of the live Pump.fun index.',
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      key: this.name,
      state: 'CREDENTIALS_MISSING',
      detail:
        'Screening runs against a synthetic demo index. Set PUMPFUN_API_BASE_URL to screen against a live index.',
      requiresCredential: this.requiresCredential,
      checkedAt: this.now(),
    };
  }
}

export const tokenSearchResponseSchema = z.object({
  tokens: z.array(
    z.object({
      mint: z.string().min(1),
      name: z.string(),
      symbol: z.string(),
      url: z.string().url().nullable().optional(),
      marketCapUsd: z.number().nonnegative().nullable().optional(),
      athMarketCapUsd: z.number().nonnegative().nullable().optional(),
      createdAt: z.string().datetime().nullable().optional(),
      holders: z.number().int().nonnegative().nullable().optional(),
      linkedPostUrl: z.string().url().nullable().optional(),
      subjectTags: z.array(z.string()).optional(),
    }),
  ),
  /** Set false by the upstream when results were truncated. */
  complete: z.boolean().optional(),
});

export interface HttpTokenIndexOptions {
  baseUrl: string | undefined;
  apiKey?: string | undefined;
  timeoutMs?: number;
  cache?: Cache;
  cacheTtlSeconds?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export class HttpTokenIndexProvider implements TokenIndexProvider {
  readonly name = 'pumpfun-http';
  readonly mode = 'http' as const;
  readonly requiresCredential = 'PUMPFUN_API_BASE_URL';

  private readonly log = childLogger({ provider: 'pumpfun-http' });
  private lastError: string | null = null;

  constructor(private readonly options: HttpTokenIndexOptions) {}

  private get now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  async search(query: TokenIndexQuery): Promise<TokenIndexResponse> {
    const queries = buildQueryStrings(query);
    const searchedAt = this.now;

    if (!this.options.baseUrl) {
      return {
        queries,
        tokens: [],
        searchedAt,
        complete: false,
        note: 'PUMPFUN_API_BASE_URL is not configured, so no duplicate search was performed.',
      };
    }

    const params = new URLSearchParams();
    if (query.ticker) params.set('symbol', query.ticker);
    if (query.name) params.set('name', query.name);
    if (query.subject) params.set('q', query.subject);

    const key = cacheKey(['tokensearch', params.toString()]);
    const ttl = this.options.cacheTtlSeconds ?? 600;

    const run = async (): Promise<TokenIndexResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
      await providerLimiter.acquire(this.name);

      try {
        const doFetch = this.options.fetchImpl ?? fetch;
        const response = await doFetch(
          `${this.options.baseUrl!.replace(/\/$/, '')}/search?${params.toString()}`,
          {
            headers: {
              accept: 'application/json',
              'user-agent': 'ViralCoinRadar/1.0',
              ...(this.options.apiKey ? { 'x-api-key': this.options.apiKey } : {}),
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          // An unreachable index must never read as "no duplicates found".
          return {
            queries,
            tokens: [],
            searchedAt,
            complete: false,
            note: `Token index returned HTTP ${response.status}; duplication could not be established.`,
          };
        }

        const parsed = tokenSearchResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          return {
            queries,
            tokens: [],
            searchedAt,
            complete: false,
            note: 'Token index response did not match the expected contract.',
          };
        }

        const tokens: IndexedToken[] = parsed.data.tokens.map((t) => ({
          mintAddress: t.mint,
          name: t.name,
          ticker: t.symbol,
          url: t.url ?? null,
          marketCapUsd: t.marketCapUsd ?? null,
          athMarketCapUsd: t.athMarketCapUsd ?? null,
          createdAt: t.createdAt ? new Date(t.createdAt) : null,
          holders: t.holders ?? null,
          linkedPostUrl: t.linkedPostUrl ?? null,
          subjectTags: t.subjectTags ?? [],
          source: 'OFFICIAL_API',
          confidence: 'HIGH',
        }));

        this.lastError = null;
        return {
          queries,
          tokens,
          searchedAt,
          complete: parsed.data.complete ?? true,
        };
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.log.error({ err: this.lastError }, 'token index search failed');
        return {
          queries,
          tokens: [],
          searchedAt,
          complete: false,
          note: `Token index request failed: ${this.lastError}`,
        };
      } finally {
        clearTimeout(timer);
      }
    };

    return this.options.cache ? this.options.cache.wrap(key, ttl, run) : run();
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = this.now;
    if (!this.options.baseUrl) {
      return {
        key: this.name,
        state: 'CREDENTIALS_MISSING',
        detail: 'PUMPFUN_API_BASE_URL is not set.',
        requiresCredential: this.requiresCredential,
        checkedAt,
      };
    }
    return {
      key: this.name,
      state: this.lastError ? 'DEGRADED' : 'HEALTHY',
      detail: this.lastError ?? 'Configured for live duplicate screening.',
      requiresCredential: this.requiresCredential,
      checkedAt,
    };
  }
}
