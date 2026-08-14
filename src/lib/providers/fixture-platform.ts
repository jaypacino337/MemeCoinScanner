import type { DiscoveredPost, DiscoveryFilters, Platform } from '@/lib/domain/types';
import { fixturePostsForPlatform, seedToDiscoveredPost } from '@/lib/fixtures/build';
import { FIXTURE_SEEDS } from '@/lib/fixtures/seeds';
import type { PlatformProvider, ProviderHealth } from './types';

/**
 * Fixture-backed platform provider.
 *
 * Used whenever live credentials are absent. It returns clearly-synthetic data
 * so the whole pipeline is exercisable offline; its health report always says
 * exactly which credential would be required to switch to live data.
 */
export class FixturePlatformProvider implements PlatformProvider {
  readonly mode = 'fixture' as const;
  readonly name: string;

  constructor(
    readonly platform: Platform,
    readonly requiresCredential: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.name = `${platform.toLowerCase()}-fixture`;
  }

  async discover(filters: DiscoveryFilters): Promise<DiscoveredPost[]> {
    const now = this.now();
    const cutoff = now.getTime() - filters.windowDays * 86_400_000;
    return fixturePostsForPlatform(this.platform, now).filter(
      (p) => p.post.postedAt.getTime() >= cutoff,
    );
  }

  async refresh(platformPostId: string): Promise<DiscoveredPost | null> {
    const seed = FIXTURE_SEEDS.find(
      (s) => s.platformPostId === platformPostId && s.platform === this.platform,
    );
    if (!seed) return null;
    return seedToDiscoveredPost(seed, this.now());
  }

  async health(): Promise<ProviderHealth> {
    return {
      key: this.name,
      state: 'CREDENTIALS_MISSING',
      detail: this.requiresCredential
        ? `Serving labelled demo fixtures. Set ${this.requiresCredential} to enable live data.`
        : 'Serving labelled demo fixtures.',
      requiresCredential: this.requiresCredential,
      checkedAt: this.now(),
    };
  }
}
