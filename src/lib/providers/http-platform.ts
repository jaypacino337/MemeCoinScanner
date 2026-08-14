import { z } from 'zod';
import type {
  ContentCategory,
  DiscoveredPost,
  DiscoveryFilters,
  MetricSource,
  Platform,
} from '@/lib/domain/types';
import { CONTENT_CATEGORIES } from '@/lib/domain/types';
import { childLogger } from '@/lib/infra/logger';
import { providerLimiter } from '@/lib/infra/rate-limit';
import { Cache, cacheKey } from '@/lib/infra/cache';
import { MissingCredentialError, ProviderRateLimitError, type PlatformProvider, type ProviderHealth } from './types';

/**
 * HTTP platform adapter.
 *
 * IMPORTANT — this adapter does not ship with, and does not assume, access to
 * any platform's private API. TikTok, Instagram, and X do not offer an open
 * endpoint that returns "currently viral posts with view counts" to an
 * unauthenticated caller.
 *
 * It therefore targets a *configurable* base URL that you point at whichever
 * access route you are actually licensed to use — an official developer
 * programme, or a permitted third-party data provider. The expected response
 * contract is defined by `discoverResponseSchema` below; a thin translation
 * layer in front of your provider is usually all that is needed.
 *
 * See docs/DATA_SOURCES.md for what each route requires.
 */

const metricsSchema = z.object({
  capturedAt: z.string().datetime().optional(),
  views: z.number().nonnegative().nullable().optional(),
  likes: z.number().nonnegative().nullable().optional(),
  comments: z.number().nonnegative().nullable().optional(),
  shares: z.number().nonnegative().nullable().optional(),
  saves: z.number().nonnegative().nullable().optional(),
});

const itemSchema = z.object({
  postId: z.string().min(1),
  url: z.string().url(),
  postedAt: z.string().datetime(),
  caption: z.string().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  embedUrl: z.string().url().nullable().optional(),
  embedAllowed: z.boolean().optional(),
  language: z.string().nullable().optional(),
  englishCommentRatio: z.number().min(0).max(1).nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  account: z.object({
    handle: z.string().min(1),
    displayName: z.string().nullable().optional(),
    profileUrl: z.string().url(),
    avatarUrl: z.string().url().nullable().optional(),
    followerCount: z.number().int().nonnegative().nullable().optional(),
    verified: z.boolean().optional(),
    primaryLanguage: z.string().nullable().optional(),
  }),
  /** Current counters, plus any history the provider can supply. */
  metrics: metricsSchema,
  metricHistory: z.array(metricsSchema).optional(),
  /**
   * Optional editorial enrichment. Omitted fields are treated as unknown by the
   * scorer rather than being defaulted to a favourable value.
   */
  signals: z
    .object({
      category: z.enum(CONTENT_CATEGORIES).optional(),
      subject: z.string().optional(),
      memeHook: z.string().optional(),
      whyItLands: z.string().optional(),
      mascotDirection: z.string().optional(),
      memeClarity: z.number().min(0).max(1).optional(),
      characterStrength: z.number().min(0).max(1).optional(),
      pfpSuitability: z.number().min(0).max(1).optional(),
      expandability: z.number().min(0).max(1).optional(),
      originality: z.number().min(0).max(1).optional(),
      sponsored: z.boolean().optional(),
      isStaleTrendRevival: z.boolean().optional(),
      knownAliases: z.array(z.string()).optional(),
    })
    .optional(),
});

export const discoverResponseSchema = z.object({
  /** How the upstream obtained these numbers, so we can label them honestly. */
  metricSource: z
    .enum(['OFFICIAL_API', 'PUBLIC_PAGE', 'THIRD_PARTY_AGGREGATOR', 'ESTIMATED'])
    .default('THIRD_PARTY_AGGREGATOR'),
  items: z.array(itemSchema),
});

export type DiscoverResponse = z.infer<typeof discoverResponseSchema>;

export interface HttpPlatformOptions {
  platform: Platform;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  credentialVariable: string;
  /** Header used to pass the key; X uses `Authorization: Bearer`. */
  authScheme?: 'bearer' | 'x-api-key';
  timeoutMs?: number;
  cache?: Cache;
  cacheTtlSeconds?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export class HttpPlatformProvider implements PlatformProvider {
  readonly mode = 'http' as const;
  readonly platform: Platform;
  readonly name: string;
  readonly requiresCredential: string;

  private readonly log;
  private lastError: string | null = null;
  private rateLimitedUntil: Date | null = null;

  constructor(private readonly options: HttpPlatformOptions) {
    this.platform = options.platform;
    this.name = `${options.platform.toLowerCase()}-http`;
    this.requiresCredential = options.credentialVariable;
    this.log = childLogger({ provider: this.name });
  }

  private get now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private assertConfigured(): { baseUrl: string; apiKey: string } {
    const { baseUrl, apiKey } = this.options;
    if (!baseUrl || !apiKey) {
      throw new MissingCredentialError(this.name, this.options.credentialVariable);
    }
    return { baseUrl, apiKey };
  }

  private headers(apiKey: string): Record<string, string> {
    const scheme = this.options.authScheme ?? 'x-api-key';
    return {
      accept: 'application/json',
      'user-agent': 'ViralCoinRadar/1.0',
      ...(scheme === 'bearer'
        ? { authorization: `Bearer ${apiKey}` }
        : { 'x-api-key': apiKey }),
    };
  }

  private async request(path: string, params: URLSearchParams): Promise<DiscoverResponse> {
    const { baseUrl, apiKey } = this.assertConfigured();
    const url = `${baseUrl.replace(/\/$/, '')}${path}?${params.toString()}`;

    const doFetch = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);

    // Respect our own outbound budget before touching the upstream.
    await providerLimiter.acquire(this.name);

    try {
      const response = await doFetch(url, {
        headers: this.headers(apiKey),
        signal: controller.signal,
      });

      if (response.status === 429) {
        const resetHeader = response.headers.get('retry-after');
        const resetAt = resetHeader
          ? new Date(this.now.getTime() + Number(resetHeader) * 1000)
          : null;
        this.rateLimitedUntil = resetAt;
        throw new ProviderRateLimitError(this.name, resetAt);
      }

      if (!response.ok) {
        throw new Error(`${this.name} responded with HTTP ${response.status}`);
      }

      const json: unknown = await response.json();
      const parsed = discoverResponseSchema.safeParse(json);
      if (!parsed.success) {
        // A malformed upstream payload must not become half-populated results.
        throw new Error(
          `${this.name} returned a response that does not match the expected contract: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => i.path.join('.'))
            .join(', ')}`,
        );
      }

      this.lastError = null;
      this.rateLimitedUntil = null;
      return parsed.data;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log.error({ err: this.lastError }, 'provider request failed');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async discover(filters: DiscoveryFilters): Promise<DiscoveredPost[]> {
    const params = new URLSearchParams({
      platform: this.platform,
      windowDays: String(filters.windowDays),
      minViews: String(filters.minViews),
      minLikes: String(filters.minLikes),
      minFollowers: String(filters.minFollowers),
      limit: String(Math.max(filters.limit, 50)),
    });
    if (filters.requireEnglishAudience) params.set('language', 'en');
    if (filters.categories.length > 0) params.set('categories', filters.categories.join(','));

    const key = cacheKey(['discover', this.name, params.toString()]);
    const ttl = this.options.cacheTtlSeconds ?? 300;

    const run = async (): Promise<DiscoverResponse> => this.request('/discover', params);
    const payload = this.options.cache
      ? await this.options.cache.wrap(key, ttl, run)
      : await run();

    return this.mapResponse(payload);
  }

  async refresh(platformPostId: string): Promise<DiscoveredPost | null> {
    const params = new URLSearchParams({ platform: this.platform, postId: platformPostId });
    const payload = await this.request('/post', params);
    const mapped = this.mapResponse(payload);
    return mapped[0] ?? null;
  }

  private mapResponse(payload: DiscoverResponse): DiscoveredPost[] {
    const source = payload.metricSource as MetricSource;
    // Aggregated/estimated numbers get lower confidence, which the scorer
    // penalises and the UI displays.
    const confidence =
      source === 'OFFICIAL_API' ? 'HIGH' : source === 'PUBLIC_PAGE' ? 'MEDIUM' : 'LOW';

    return payload.items.map((item) => {
      const history = [...(item.metricHistory ?? []), item.metrics];
      const metrics = history.map((m) => ({
        capturedAt: m.capturedAt ? new Date(m.capturedAt) : this.now,
        views: m.views ?? null,
        likes: m.likes ?? null,
        comments: m.comments ?? null,
        shares: m.shares ?? null,
        saves: m.saves ?? null,
        followerCount: item.account.followerCount ?? null,
        source,
        confidence: confidence as 'HIGH' | 'MEDIUM' | 'LOW',
      }));

      const signals = item.signals ?? {};
      const subject = signals.subject ?? item.caption?.slice(0, 60) ?? item.postId;

      return {
        account: {
          platform: this.platform,
          handle: item.account.handle,
          displayName: item.account.displayName ?? null,
          profileUrl: item.account.profileUrl,
          avatarUrl: item.account.avatarUrl ?? null,
          followerCount: item.account.followerCount ?? null,
          verifiedAccount: item.account.verified ?? false,
          primaryLanguage: item.account.primaryLanguage ?? null,
        },
        post: {
          platform: this.platform,
          platformPostId: item.postId,
          url: item.url,
          caption: item.caption ?? null,
          thumbnailUrl: item.thumbnailUrl ?? null,
          embedUrl: item.embedUrl ?? null,
          embedAllowed: item.embedAllowed ?? false,
          postedAt: new Date(item.postedAt),
          language: item.language ?? null,
          englishCommentRatio: item.englishCommentRatio ?? null,
          hashtags: item.hashtags ?? [],
        },
        metrics,
        signals: {
          category: (signals.category ?? 'OTHER') as ContentCategory,
          subject,
          memeHook: signals.memeHook ?? '',
          whyItLands: signals.whyItLands ?? '',
          mascotDirection: signals.mascotDirection ?? '',
          memeClarity: signals.memeClarity,
          characterStrength: signals.characterStrength,
          pfpSuitability: signals.pfpSuitability,
          expandability: signals.expandability,
          originality: signals.originality,
          sponsored: signals.sponsored,
          isStaleTrendRevival: signals.isStaleTrendRevival,
          knownAliases: signals.knownAliases,
        },
      };
    });
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = this.now;
    if (!this.options.baseUrl || !this.options.apiKey) {
      return {
        key: this.name,
        state: 'CREDENTIALS_MISSING',
        detail: `${this.options.credentialVariable} is not set.`,
        requiresCredential: this.options.credentialVariable,
        checkedAt,
      };
    }
    if (this.rateLimitedUntil && this.rateLimitedUntil > checkedAt) {
      return {
        key: this.name,
        state: 'RATE_LIMITED',
        detail: `Rate limited until ${this.rateLimitedUntil.toISOString()}`,
        requiresCredential: this.options.credentialVariable,
        checkedAt,
      };
    }
    if (this.lastError) {
      return {
        key: this.name,
        state: 'DEGRADED',
        detail: this.lastError,
        requiresCredential: this.options.credentialVariable,
        checkedAt,
      };
    }
    return {
      key: this.name,
      state: 'HEALTHY',
      detail: 'Configured for live data.',
      requiresCredential: this.options.credentialVariable,
      checkedAt,
    };
  }
}
