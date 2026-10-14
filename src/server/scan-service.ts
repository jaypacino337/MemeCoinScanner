import { getEnv } from '@/env';
import type { DiscoveryFilters } from '@/lib/domain/types';
import { DEFAULT_FILTERS } from '@/lib/domain/types';
import { Cache } from '@/lib/infra/cache';
import { childLogger } from '@/lib/infra/logger';
import { JobQueue } from '@/lib/infra/queue';
import { runScan, type ScanResult } from '@/lib/pipeline/run-scan';
import { buildRegistry, isFullyFixtureMode, type Registry } from '@/lib/providers/registry';
import { prisma } from './db';
import { persistCandidate, persistScanResult, recordHealth } from './persist';
import { PrismaCacheStore, PrismaJobStore } from './stores';

/**
 * Wiring layer: registry + pipeline + persistence.
 *
 * Kept out of the pipeline itself so `runScan` stays storage-free and testable.
 */

const cache = new Cache(new PrismaCacheStore(prisma));
const log = childLogger({ stage: 'scan-service' });

export function getCache(): Cache {
  return cache;
}

export function getRegistry(): Registry {
  return buildRegistry({ cache });
}

/**
 * In fixture mode the demo URLs point at real platform hosts but fabricated
 * post ids, so a live HEAD request would only ever produce a misleading
 * "unreachable". We run the structural check and stop there, which lands every
 * fixture candidate at UNVERIFIED — the honest state for demo data.
 */
function shouldPerformNetworkCheck(registry: Registry): boolean {
  const env = getEnv();
  if (!env.ENABLE_LINK_VERIFICATION) return false;
  return !isFullyFixtureMode(registry);
}

export async function executeScan(
  filters: Partial<DiscoveryFilters> = {},
  trigger = 'manual',
): Promise<{ scanRunId: string; result: ScanResult; fixtureMode: boolean }> {
  const registry = getRegistry();
  const merged: DiscoveryFilters = { ...DEFAULT_FILTERS, ...filters };

  log.info({ trigger, filters: merged }, 'starting scan');

  const result = await runScan({
    providers: registry.platforms,
    tokenIndex: registry.tokenIndex,
    filters: merged,
    verifyOptions: {
      performNetworkCheck: shouldPerformNetworkCheck(registry),
      timeoutMs: getEnv().HTTP_TIMEOUT_MS,
    },
  });

  const { scanRunId } = await persistScanResult(prisma, result, merged, trigger);

  const healthEntries = await Promise.all([
    ...[...registry.platforms.values()].map((p) => p.health()),
    registry.tokenIndex.health(),
  ]);
  await recordHealth(
    prisma,
    healthEntries.map((h) => ({
      sourceKey: h.key,
      state: h.state,
      detail: h.detail,
      checkedAt: h.checkedAt,
    })),
  );

  return { scanRunId, result, fixtureMode: isFullyFixtureMode(registry) };
}

/** Re-reads one candidate's metrics from its provider and re-scores it. */
export async function rescanCandidate(candidateId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const candidate = await prisma.viralCandidate.findUnique({
    where: { id: candidateId },
    include: { post: { include: { account: true } } },
  });

  if (!candidate) return { ok: false, message: 'Candidate not found' };

  const registry = getRegistry();
  const provider = registry.platforms.get(candidate.post.platform);
  if (!provider) {
    return { ok: false, message: `No provider registered for ${candidate.post.platform}` };
  }

  const refreshed = await provider.refresh(candidate.post.platformPostId);
  if (!refreshed) {
    return {
      ok: false,
      message: 'Provider could not return current metrics for this post',
    };
  }

  const result = await runScan({
    providers: new Map([[candidate.post.platform, singlePostProvider(provider, refreshed)]]),
    tokenIndex: registry.tokenIndex,
    filters: {
      ...DEFAULT_FILTERS,
      platforms: [candidate.post.platform],
      // A targeted rescan must not re-apply discovery thresholds: the user is
      // asking about this specific post, not re-running discovery.
      minViews: 0,
      minLikes: 0,
      minFollowers: 0,
      windowDays: 3650,
      requireEnglishAudience: false,
    },
    verifyOptions: {
      performNetworkCheck: shouldPerformNetworkCheck(registry),
      timeoutMs: getEnv().HTTP_TIMEOUT_MS,
    },
  });

  const draft = result.candidates[0];
  if (!draft) {
    const reason = result.rejected[0]?.reason ?? 'Post no longer passes verification';
    return { ok: false, message: reason };
  }

  await persistCandidate(prisma, draft, null);
  return { ok: true, message: 'Metrics refreshed' };
}

/** Wraps a provider so discovery returns exactly one already-fetched post. */
function singlePostProvider(
  provider: ReturnType<Registry['platforms']['get']> & object,
  post: Awaited<ReturnType<NonNullable<ReturnType<Registry['platforms']['get']>>['refresh']>>,
): NonNullable<ReturnType<Registry['platforms']['get']>> {
  return {
    platform: provider.platform,
    name: provider.name,
    mode: provider.mode,
    requiresCredential: provider.requiresCredential,
    discover: async () => (post ? [post] : []),
    refresh: (id: string) => provider.refresh(id),
    health: () => provider.health(),
  };
}

/** Background queue used by the scheduled worker endpoint. */
export function buildQueue(): JobQueue {
  const queue = new JobQueue(new PrismaJobStore(prisma), {
    queue: 'ingestion',
    maxAttempts: 3,
    backoffMs: 5000,
  });

  queue.register('scan', async (payload) => {
    const filters = (payload ?? {}) as Partial<DiscoveryFilters>;
    await executeScan(filters, 'scheduled');
  });

  queue.register('rescan-candidate', async (payload) => {
    const { candidateId } = (payload ?? {}) as { candidateId?: string };
    if (!candidateId) throw new Error('rescan-candidate requires candidateId');
    const result = await rescanCandidate(candidateId);
    if (!result.ok) throw new Error(result.message);
  });

  queue.register('purge-cache', async () => {
    const store = new PrismaCacheStore(prisma);
    const purged = await store.purgeExpired(new Date());
    log.info({ purged }, 'purged expired cache entries');
  });

  return queue;
}

export async function getHealthSnapshot(): Promise<
  Array<{
    sourceKey: string;
    state: string;
    detail: string;
    requiresCredential: string | null;
    mode: string;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    consecutiveFailures: number;
  }>
> {
  const registry = getRegistry();
  const providers = [...registry.platforms.values(), registry.tokenIndex, registry.walletActivity];
  const live = await Promise.all(providers.map((p) => p.health()));
  const stored = await prisma.dataSourceHealth.findMany();
  const storedByKey = new Map(stored.map((s) => [s.sourceKey, s]));

  return live.map((health, index) => {
    const provider = providers[index];
    const row = storedByKey.get(health.key);
    return {
      sourceKey: health.key,
      state: health.state,
      detail: health.detail,
      requiresCredential: health.requiresCredential,
      mode: provider?.mode ?? 'unknown',
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
    };
  });
}
