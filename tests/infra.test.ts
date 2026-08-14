import { describe, expect, it, vi } from 'vitest';
import { Cache, type PersistentCacheStore } from '@/lib/infra/cache';
import { InMemoryJobStore, JobQueue } from '@/lib/infra/queue';
import { RateLimiter } from '@/lib/infra/rate-limit';
import { computeVelocity, engagementRate, sevenDayCurve } from '@/lib/pipeline/velocity';
import type { MetricObservation } from '@/lib/domain/types';

const NOW = new Date('2026-08-14T12:00:00Z');

function obs(hoursAgo: number, views: number, likes = 0): MetricObservation {
  return {
    capturedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    views,
    likes,
    comments: 0,
    shares: 0,
    source: 'OFFICIAL_API',
    confidence: 'HIGH',
  };
}

describe('computeVelocity', () => {
  const postedAt = new Date(NOW.getTime() - 72 * 3_600_000);

  it('returns nulls rather than inventing a rate from one snapshot', () => {
    const report = computeVelocity([obs(0, 1_000_000)], postedAt, NOW);

    expect(report.viewsPerHour).toBeNull();
    expect(report.engagementAcceleration).toBeNull();
    expect(report.momentum).toBe('UNKNOWN');
    // A lifetime average is still derivable from a single point.
    expect(report.lifetimeViewsPerHour).toBeCloseTo(1_000_000 / 72, 3);
  });

  it('computes views per hour between the two most recent snapshots', () => {
    const report = computeVelocity([obs(10, 1_000_000), obs(0, 1_500_000)], postedAt, NOW);
    expect(report.viewsPerHour).toBeCloseTo(50_000, 3);
  });

  it('detects accelerating momentum', () => {
    const report = computeVelocity(
      [obs(20, 1_000_000), obs(10, 1_200_000), obs(0, 2_000_000)],
      postedAt,
      NOW,
    );

    expect(report.momentum).toBe('ACCELERATING');
    expect(report.engagementAcceleration).toBeGreaterThan(0);
  });

  it('detects decaying momentum', () => {
    const report = computeVelocity(
      [obs(20, 1_000_000), obs(10, 1_800_000), obs(0, 1_900_000)],
      postedAt,
      NOW,
    );

    expect(report.momentum).toBe('DECAYING');
    expect(report.engagementAcceleration).toBeLessThan(0);
  });

  it('clamps a downward counter revision to zero rather than reporting negative growth', () => {
    const report = computeVelocity([obs(10, 2_000_000), obs(0, 1_900_000)], postedAt, NOW);
    expect(report.viewsPerHour).toBe(0);
  });

  it('ignores snapshots captured at the same instant', () => {
    const report = computeVelocity([obs(0, 1_000_000), obs(0, 1_200_000)], postedAt, NOW);
    expect(report.viewsPerHour).toBeNull();
  });

  it('sorts unordered observations before computing', () => {
    const ordered = computeVelocity([obs(10, 1_000_000), obs(0, 1_500_000)], postedAt, NOW);
    const shuffled = computeVelocity([obs(0, 1_500_000), obs(10, 1_000_000)], postedAt, NOW);
    expect(shuffled.viewsPerHour).toBe(ordered.viewsPerHour);
  });
});

describe('engagementRate', () => {
  it('divides total interactions by views', () => {
    const rate = engagementRate({
      capturedAt: NOW,
      views: 1000,
      likes: 100,
      comments: 20,
      shares: 30,
      source: 'OFFICIAL_API',
      confidence: 'HIGH',
    });
    expect(rate).toBeCloseTo(0.15, 5);
  });

  it('returns null when views are unknown or zero', () => {
    expect(
      engagementRate({
        capturedAt: NOW,
        views: null,
        likes: 5,
        comments: 0,
        shares: 0,
        source: 'OFFICIAL_API',
        confidence: 'HIGH',
      }),
    ).toBeNull();
  });
});

describe('sevenDayCurve', () => {
  it('returns only observations inside the seven-day window', () => {
    const points = sevenDayCurve([obs(24 * 10, 1), obs(24 * 3, 2), obs(0, 3)], NOW);
    expect(points).toHaveLength(2);
  });
});

describe('RateLimiter', () => {
  it('allows requests up to capacity then blocks', () => {
    const clock = 0;
    const limiter = new RateLimiter(3, 1, () => clock);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);

    const blocked = limiter.check('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    let clock = 0;
    const limiter = new RateLimiter(1, 1, () => clock);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    clock = 1000;
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('tracks buckets independently per key', () => {
    const clock = 0;
    const limiter = new RateLimiter(1, 1, () => clock);

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('rejects invalid configuration', () => {
    expect(() => new RateLimiter(0, 1)).toThrow();
    expect(() => new RateLimiter(1, 0)).toThrow();
  });
});

describe('Cache', () => {
  it('returns a cached value before expiry and null after', async () => {
    let clock = new Date('2026-08-14T12:00:00Z');
    const cache = new Cache(null, () => clock);

    await cache.set('k', { v: 1 }, 60);
    expect(await cache.get('k')).toEqual({ v: 1 });

    clock = new Date(clock.getTime() + 61_000);
    expect(await cache.get('k')).toBeNull();
  });

  it('computes only once for repeated wrap calls', async () => {
    const cache = new Cache();
    const compute = vi.fn(async () => 42);

    expect(await cache.wrap('k', 60, compute)).toBe(42);
    expect(await cache.wrap('k', 60, compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('falls through to the persistent store on a memory miss', async () => {
    const backing = new Map<string, { value: unknown; expiresAt: Date }>();
    const store: PersistentCacheStore = {
      get: async (key) => backing.get(key) ?? null,
      set: async (key, value, expiresAt) => {
        backing.set(key, { value, expiresAt });
      },
      delete: async (key) => {
        backing.delete(key);
      },
      purgeExpired: async () => 0,
    };

    const writer = new Cache(store);
    await writer.set('shared', 'hello', 60);

    const reader = new Cache(store);
    expect(await reader.get('shared')).toBe('hello');
  });
});

describe('JobQueue', () => {
  it('runs a queued job and marks it succeeded', async () => {
    const store = new InMemoryJobStore();
    const queue = new JobQueue(store, { queue: 'test' });
    const handler = vi.fn(async () => {});
    queue.register('work', handler);

    await queue.enqueue('work', { a: 1 });
    const result = await queue.drain();

    expect(result.processed).toBe(1);
    expect(handler).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ name: 'work' }));
    expect((await queue.stats()).SUCCEEDED).toBe(1);
  });

  it('retries a failing job with backoff, then marks it dead', async () => {
    let clock = new Date('2026-08-14T12:00:00Z');
    const store = new InMemoryJobStore();
    const queue = new JobQueue(store, {
      queue: 'test',
      maxAttempts: 2,
      backoffMs: 1000,
      now: () => clock,
    });
    queue.register('flaky', async () => {
      throw new Error('nope');
    });

    await queue.enqueue('flaky', {});

    const first = await queue.drain();
    expect(first.failed).toBe(1);
    expect((await queue.stats()).QUEUED).toBe(1);

    clock = new Date(clock.getTime() + 2000);
    const second = await queue.drain();
    expect(second.failed).toBe(1);
    expect((await queue.stats()).DEAD).toBe(1);
  });

  it('refuses to enqueue a job with no registered handler', async () => {
    const queue = new JobQueue(new InMemoryJobStore(), { queue: 'test' });
    await expect(queue.enqueue('missing', {})).rejects.toThrow(/No handler/);
  });

  it('does not run jobs scheduled for the future', async () => {
    const clock = new Date('2026-08-14T12:00:00Z');
    const queue = new JobQueue(new InMemoryJobStore(), { queue: 'test', now: () => clock });
    queue.register('later', async () => {});

    await queue.enqueue('later', {}, 60_000);
    expect((await queue.drain()).processed).toBe(0);
  });
});
