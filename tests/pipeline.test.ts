import { describe, expect, it } from 'vitest';
import type {
  DiscoveredPost,
  DiscoveryFilters,
  MetricObservation,
  Platform,
  TokenIndexQuery,
  TokenIndexResponse,
} from '@/lib/domain/types';
import { DEFAULT_FILTERS } from '@/lib/domain/types';
import { runScan } from '@/lib/pipeline/run-scan';
import { applyFilters, deriveRisks } from '@/lib/pipeline/filters';
import { computeMeta } from '@/lib/pipeline/meta';
import { computeVelocity } from '@/lib/pipeline/velocity';
import type { PlatformProvider, ProviderHealth, TokenIndexProvider } from '@/lib/providers/types';
import { fixturePostsForPlatform } from '@/lib/fixtures/build';
import { buildTokenFixtures } from '@/lib/fixtures/tokens';

/**
 * Integration coverage for the scan pipeline: providers in, ranked candidate
 * drafts out, with no database involved.
 */

const NOW = new Date('2026-08-14T12:00:00Z');
const now = (): Date => NOW;

class StubPlatformProvider implements PlatformProvider {
  readonly mode = 'fixture' as const;
  readonly name: string;
  readonly requiresCredential = null;

  constructor(
    readonly platform: Platform,
    private readonly posts: DiscoveredPost[],
    private readonly failWith?: Error,
  ) {
    this.name = `stub-${platform}`;
  }

  async discover(): Promise<DiscoveredPost[]> {
    if (this.failWith) throw this.failWith;
    return this.posts;
  }

  async refresh(id: string): Promise<DiscoveredPost | null> {
    return this.posts.find((p) => p.post.platformPostId === id) ?? null;
  }

  async health(): Promise<ProviderHealth> {
    return {
      key: this.name,
      state: 'HEALTHY',
      detail: 'stub',
      requiresCredential: null,
      checkedAt: NOW,
    };
  }
}

class StubTokenIndex implements TokenIndexProvider {
  readonly name = 'stub-index';
  readonly mode = 'fixture' as const;
  readonly requiresCredential = null;
  calls: TokenIndexQuery[] = [];

  constructor(private readonly complete = true) {}

  async search(query: TokenIndexQuery): Promise<TokenIndexResponse> {
    this.calls.push(query);
    const canonical = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const terms = [query.ticker, query.name, query.subject]
      .filter((t): t is string => Boolean(t))
      .map(canonical);

    const tokens = buildTokenFixtures(NOW).filter((t) => {
      const haystack = [canonical(t.name), canonical(t.ticker), ...(t.subjectTags ?? []).map(canonical)];
      return terms.some((term) => haystack.some((h) => h.includes(term) || term.includes(h)));
    });

    return {
      queries: [
        ...(query.ticker ? [`ticker:${query.ticker}`] : []),
        ...(query.name ? [`name:${query.name}`] : []),
        ...(query.subject ? [`subject:${query.subject}`] : []),
      ],
      tokens,
      searchedAt: NOW,
      complete: this.complete,
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      key: this.name,
      state: 'HEALTHY',
      detail: 'stub',
      requiresCredential: null,
      checkedAt: NOW,
    };
  }
}

function filters(overrides: Partial<DiscoveryFilters> = {}): DiscoveryFilters {
  return {
    ...DEFAULT_FILTERS,
    windowDays: 90,
    minViews: 0,
    requireEnglishAudience: false,
    ...overrides,
  };
}

function providersFor(platforms: Platform[]): Map<Platform, PlatformProvider> {
  const map = new Map<Platform, PlatformProvider>();
  for (const platform of platforms) {
    map.set(platform, new StubPlatformProvider(platform, fixturePostsForPlatform(platform, NOW)));
  }
  return map;
}

/** Builds a scan config whose filters cover exactly the registered providers. */
function scanFor(
  platforms: Platform[],
  overrides: Partial<DiscoveryFilters> = {},
): { providers: Map<Platform, PlatformProvider>; filters: DiscoveryFilters } {
  return {
    providers: providersFor(platforms),
    filters: filters({ platforms, ...overrides }),
  };
}

describe('runScan', () => {
  it('produces scored, screened candidates from the fixture providers', async () => {
    const result = await runScan({
      ...scanFor(['TIKTOK', 'INSTAGRAM', 'X']),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.stats.postsSeen).toBeGreaterThan(20);
    expect(result.candidates.length).toBeGreaterThan(10);

    for (const candidate of result.candidates) {
      expect(candidate.score.opportunityScore).toBeGreaterThanOrEqual(0);
      expect(candidate.score.opportunityScore).toBeLessThanOrEqual(100);
      // Every candidate carries a primary concept plus three alternates.
      expect(candidate.concepts.filter((c) => c.isPrimary)).toHaveLength(1);
      expect(candidate.concepts).toHaveLength(4);
      expect(candidate.concepts.every((c) => c.suggestion.ticker.length <= 10)).toBe(true);
    }
  });

  it('labels fixture data as unverified and never as verified', async () => {
    const result = await runScan({
      ...scanFor(['TIKTOK']),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    for (const candidate of result.candidates) {
      expect(candidate.metricSource).toBe('SYNTHETIC_FIXTURE');
      expect(candidate.confidence).toBe('UNVERIFIED');
      expect(candidate.verificationState).toBe('UNVERIFIED');
      expect(candidate.lastVerifiedAt).toBeNull();
    }
  });

  it('excludes a post whose central subject is a vulnerable person', async () => {
    const result = await runScan({
      ...scanFor(['INSTAGRAM']),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    const excluded = result.rejected.find((r) => r.subject === 'fallen cone');
    expect(excluded).toBeDefined();
    expect(excluded?.stage).toBe('scoring');
  });

  it('excludes a generic post with no central joke', async () => {
    const result = await runScan({
      ...scanFor(['X']),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.rejected.some((r) => r.subject === 'generic reaction clip')).toBe(true);
    expect(result.candidates.some((c) => c.discovered.signals.subject === 'generic reaction clip')).toBe(
      false,
    );
  });

  it('marks a subject with an established token as OCCUPIED', async () => {
    const result = await runScan({
      ...scanFor(['TIKTOK']),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    const cabinetCat = result.candidates.find(
      (c) => c.discovered.signals.subject === 'cabinet cat',
    );
    expect(cabinetCat).toBeDefined();
    const primary = cabinetCat?.concepts.find((c) => c.isPrimary);
    expect(primary?.report.status).toBe('OCCUPIED');
  });

  it('applies the minimum-views threshold before verification', async () => {
    const result = await runScan({
      ...scanFor(['TIKTOK', 'INSTAGRAM', 'X'], { minViews: 30_000_000 }),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    for (const candidate of result.candidates) {
      const views = candidate.discovered.metrics[candidate.discovered.metrics.length - 1]?.views;
      expect(views).toBeGreaterThanOrEqual(30_000_000);
    }
    expect(result.rejected.some((r) => r.stage === 'filter')).toBe(true);
  });

  it('honours the animals-only and cats-and-dogs-only filters', async () => {
    const animals = await runScan({
      ...scanFor(['TIKTOK', 'INSTAGRAM', 'X'], { animalsOnly: true }),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });
    expect(animals.candidates.length).toBeGreaterThan(0);
    expect(
      animals.candidates.every((c) =>
        ['ANIMAL', 'CAT_OR_DOG'].includes(c.discovered.signals.category),
      ),
    ).toBe(true);

    const pets = await runScan({
      ...scanFor(['TIKTOK'], { catsAndDogsOnly: true }),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });
    expect(pets.candidates.every((c) => c.discovered.signals.category === 'CAT_OR_DOG')).toBe(true);
  });

  it('drops non-clean concepts when requireCleanPumpFun is set', async () => {
    const result = await runScan({
      ...scanFor(['TIKTOK', 'INSTAGRAM', 'X'], { requireCleanPumpFun: true }),
      tokenIndex: new StubTokenIndex(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.candidates.every((c) => c.screeningStatus === 'CLEAN')).toBe(true);
  });

  it('records a provider failure without aborting the whole scan', async () => {
    const providers = providersFor(['TIKTOK', 'X']);
    providers.set(
      'INSTAGRAM',
      new StubPlatformProvider('INSTAGRAM', [], new Error('upstream exploded')),
    );

    const result = await runScan({
      providers,
      tokenIndex: new StubTokenIndex(),
      filters: filters(),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.platform).toBe('INSTAGRAM');
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('marks everything UNCERTAIN when the token index cannot complete', async () => {
    const result = await runScan({
      ...scanFor(['X']),
      tokenIndex: new StubTokenIndex(false),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.screeningStatus === 'UNCERTAIN')).toBe(true);
  });

  it('rejects a post whose URL is not a direct original link', async () => {
    const posts = fixturePostsForPlatform('TIKTOK', NOW).slice(0, 1);
    const tampered = posts.map((p) => ({
      ...p,
      post: { ...p.post, url: 'https://knowyourmeme.com/memes/weather-goat' },
    }));

    const result = await runScan({
      providers: new Map([['TIKTOK', new StubPlatformProvider('TIKTOK', tampered)]]),
      tokenIndex: new StubTokenIndex(),
      filters: filters({ platforms: ['TIKTOK'] }),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]?.stage).toBe('verification');
  });

  it('rejects a post whose URL handle does not match the stored creator', async () => {
    const posts = fixturePostsForPlatform('TIKTOK', NOW).slice(0, 1);
    const tampered = posts.map((p) => ({
      ...p,
      post: { ...p.post, url: 'https://www.tiktok.com/@someone_else/video/7411000000000000001' },
    }));

    const result = await runScan({
      providers: new Map([['TIKTOK', new StubPlatformProvider('TIKTOK', tampered)]]),
      tokenIndex: new StubTokenIndex(),
      filters: filters({ platforms: ['TIKTOK'] }),
      now,
      verifyOptions: { performNetworkCheck: false },
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/stored creator/i);
  });
});

describe('fixture growth series', () => {
  it('advances view counts between two scans so velocity is measurable', () => {
    // Regression guard: the fixture curve used to terminate at exactly the
    // seed's declared total regardless of when it was generated, so two scans
    // recorded identical numbers and every computed velocity was zero.
    const early = new Date('2026-08-14T16:00:00Z');
    const later = new Date('2026-08-14T16:20:00Z');

    const a = fixturePostsForPlatform('TIKTOK', early)[0];
    const b = fixturePostsForPlatform('TIKTOK', later)[0];
    if (!a || !b) throw new Error('expected fixture posts');

    const viewsAt = (post: DiscoveredPost): number => {
      const last = post.metrics[post.metrics.length - 1];
      if (!last || last.views === null) throw new Error('expected a view count');
      return last.views;
    };

    expect(viewsAt(b)).toBeGreaterThan(viewsAt(a));

    const merged = [...a.metrics, ...b.metrics];
    const velocity = computeVelocity(merged, b.post.postedAt, later);
    expect(velocity.viewsPerHour).not.toBeNull();
    expect(velocity.viewsPerHour ?? 0).toBeGreaterThan(0);
  });

  it('keeps a post at the same age across a single day so it stays recent', () => {
    const morning = new Date('2026-08-14T08:00:00Z');
    const evening = new Date('2026-08-14T20:00:00Z');

    const a = fixturePostsForPlatform('TIKTOK', morning)[0];
    const b = fixturePostsForPlatform('TIKTOK', evening)[0];
    if (!a || !b) throw new Error('expected fixture posts');

    // Anchored to midnight, so postedAt is stable within the day and the post
    // genuinely ages rather than being perpetually the same number of hours old.
    expect(a.post.postedAt.getTime()).toBe(b.post.postedAt.getTime());
  });
});

describe('applyFilters', () => {
  const post = (): DiscoveredPost => {
    const base = fixturePostsForPlatform('TIKTOK', NOW)[0];
    if (!base) throw new Error('expected a fixture post');
    return base;
  };

  it('rejects posts outside the requested window', () => {
    const item = post();
    const outcome = applyFilters(item, filters({ windowDays: 1 }), [], NOW);
    expect(outcome.passed).toBe(false);
    expect(outcome.reason).toMatch(/window/i);
  });

  it('rejects when no view count is available to test the minimum', () => {
    const item = post();
    const noViews: MetricObservation[] = item.metrics.map((m) => ({ ...m, views: null }));
    const outcome = applyFilters(
      { ...item, metrics: noViews },
      filters({ minViews: 1_000_000 }),
      [],
      NOW,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.reason).toMatch(/No view count available/i);
  });

  it('rejects celebrity/IP risk when the toggle is set', () => {
    const outcome = applyFilters(
      post(),
      filters({ noCelebrityOrIpRisk: true }),
      [{ kind: 'COPYRIGHT', severity: 'FLAG', note: 'IP' }],
      NOW,
    );
    expect(outcome.passed).toBe(false);
  });

  it('separates early-signal from already-giga-viral posts', () => {
    const item = post(); // ~41.8M views in the fixtures
    expect(applyFilters(item, filters({ signalStage: 'early' }), [], NOW).passed).toBe(false);
    expect(applyFilters(item, filters({ signalStage: 'giga' }), [], NOW).passed).toBe(true);
  });
});

describe('deriveRisks', () => {
  it('excludes content referencing death or serious illness', () => {
    const item = fixturePostsForPlatform('TIKTOK', NOW)[0];
    if (!item) throw new Error('expected a fixture post');
    const mutated: DiscoveredPost = {
      ...item,
      post: { ...item.post, caption: 'a tribute to our friend who passed away last week' },
    };

    const risks = deriveRisks(mutated);
    const tragedy = risks.find((r) => r.kind === 'TRAGEDY');
    expect(tragedy?.severity).toBe('EXCLUDE');
  });

  it('flags political content without excluding it', () => {
    const item = fixturePostsForPlatform('X', NOW).find((p) => p.signals.category === 'NEWS_MOMENT');
    if (!item) throw new Error('expected a news fixture');
    const mutated: DiscoveredPost = {
      ...item,
      post: { ...item.post, caption: 'the presidential candidate debate moment' },
    };

    const risks = deriveRisks(mutated);
    expect(risks.find((r) => r.kind === 'POLITICS')?.severity).toBe('FLAG');
  });

  it('flags aggregator-only sourcing', () => {
    const item = fixturePostsForPlatform('X', NOW)[0];
    if (!item) throw new Error('expected a fixture post');
    const mutated: DiscoveredPost = {
      ...item,
      metrics: item.metrics.map((m) => ({ ...m, source: 'THIRD_PARTY_AGGREGATOR' as const })),
    };

    expect(deriveRisks(mutated).some((r) => r.kind === 'WEAK_SOURCING')).toBe(true);
  });
});

describe('computeMeta', () => {
  it('reports nothing rather than guessing on a thin sample', () => {
    const report = computeMeta(
      [
        {
          name: 'Solo',
          ticker: 'SOLO',
          marketCapUsd: 500_000,
          athMarketCapUsd: null,
          createdAt: NOW,
          subjectTags: [],
        },
      ],
      { now: NOW },
    );

    expect(report.meaningful).toBe(false);
    expect(report.patterns).toHaveLength(0);
  });

  it('surfaces repeated framings across recent launches', () => {
    const observations = buildTokenFixtures(NOW).map((t) => ({
      name: t.name,
      ticker: t.ticker,
      marketCapUsd: t.marketCapUsd,
      athMarketCapUsd: t.athMarketCapUsd,
      createdAt: t.createdAt,
      subjectTags: t.subjectTags ?? [],
    }));

    const report = computeMeta(observations, { now: NOW, windowDays: 30 });

    expect(report.meaningful).toBe(true);
    expect(report.patterns.length).toBeGreaterThan(0);
    expect(report.patterns.every((p) => p.share >= 0 && p.share <= 1)).toBe(true);
    // The caveat must always travel with the data.
    expect(report.caveat).toMatch(/not a prediction/i);
  });
});
