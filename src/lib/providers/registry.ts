import type { Platform } from '@/lib/domain/types';
import { getEnv } from '@/env';
import { Cache } from '@/lib/infra/cache';
import { FixturePlatformProvider } from './fixture-platform';
import { HttpPlatformProvider } from './http-platform';
import { FixtureTokenIndexProvider, HttpTokenIndexProvider } from './pumpfun';
import type { PlatformProvider, TokenIndexProvider } from './types';

/**
 * Provider registry.
 *
 * Selection is per-platform, not global: if you hold X access but not TikTok
 * access, X runs live while TikTok continues to serve labelled fixtures. This
 * is why every adapter is behind an interface — swapping one never touches the
 * others or the pipeline.
 */

export interface Registry {
  platforms: Map<Platform, PlatformProvider>;
  tokenIndex: TokenIndexProvider;
}

const CREDENTIAL_BY_PLATFORM: Record<Platform, string> = {
  TIKTOK: 'TIKTOK_API_KEY + TIKTOK_API_BASE_URL',
  INSTAGRAM: 'INSTAGRAM_API_KEY + INSTAGRAM_API_BASE_URL',
  X: 'X_BEARER_TOKEN + X_API_BASE_URL',
};

export function buildRegistry(options: { cache?: Cache; now?: () => Date } = {}): Registry {
  const env = getEnv();
  const now = options.now ?? (() => new Date());
  const cache = options.cache;
  const live = env.DATA_MODE === 'live';

  const platforms = new Map<Platform, PlatformProvider>();

  const makePlatform = (
    platform: Platform,
    baseUrl: string | undefined,
    apiKey: string | undefined,
    authScheme: 'bearer' | 'x-api-key',
  ): PlatformProvider => {
    if (live && baseUrl && apiKey) {
      return new HttpPlatformProvider({
        platform,
        baseUrl,
        apiKey,
        credentialVariable: CREDENTIAL_BY_PLATFORM[platform],
        authScheme,
        timeoutMs: env.HTTP_TIMEOUT_MS,
        cache,
        cacheTtlSeconds: env.CACHE_TTL_SECONDS,
        now,
      });
    }
    return new FixturePlatformProvider(platform, CREDENTIAL_BY_PLATFORM[platform], now);
  };

  platforms.set(
    'TIKTOK',
    makePlatform('TIKTOK', env.TIKTOK_API_BASE_URL, env.TIKTOK_API_KEY, 'x-api-key'),
  );
  platforms.set(
    'INSTAGRAM',
    makePlatform('INSTAGRAM', env.INSTAGRAM_API_BASE_URL, env.INSTAGRAM_API_KEY, 'x-api-key'),
  );
  platforms.set('X', makePlatform('X', env.X_API_BASE_URL, env.X_BEARER_TOKEN, 'bearer'));

  const tokenIndex: TokenIndexProvider =
    live && env.PUMPFUN_API_BASE_URL
      ? new HttpTokenIndexProvider({
          baseUrl: env.PUMPFUN_API_BASE_URL,
          apiKey: env.PUMPFUN_API_KEY,
          timeoutMs: env.HTTP_TIMEOUT_MS,
          cache,
          cacheTtlSeconds: env.CACHE_TTL_SECONDS,
          now,
        })
      : new FixtureTokenIndexProvider(now);

  return { platforms, tokenIndex };
}

/** True when every configured provider is serving fixtures. */
export function isFullyFixtureMode(registry: Registry): boolean {
  return (
    [...registry.platforms.values()].every((p) => p.mode === 'fixture') &&
    registry.tokenIndex.mode === 'fixture'
  );
}
