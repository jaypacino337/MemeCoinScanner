/**
 * Token-bucket rate limiter used for two distinct jobs:
 *  - throttling our own outbound calls to each upstream provider
 *  - protecting the app's own API routes from a hot client
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until at least one token is available. 0 when allowed. */
  retryAfterMs: number;
  limit: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (capacity <= 0) throw new Error('RateLimiter capacity must be > 0');
    if (refillPerSecond <= 0) throw new Error('RateLimiter refillPerSecond must be > 0');
  }

  check(key: string, cost = 1): RateLimitResult {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };

    const elapsedSeconds = Math.max(0, (now - bucket.lastRefill) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
        limit: this.capacity,
      };
    }

    this.buckets.set(key, bucket);
    const deficit = cost - bucket.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.ceil((deficit / this.refillPerSecond) * 1000),
      limit: this.capacity,
    };
  }

  /** Blocks until a token is available, then consumes it. */
  async acquire(key: string, cost = 1): Promise<void> {
    for (;;) {
      const result = this.check(key, cost);
      if (result.allowed) return;
      await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs));
    }
  }

  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }
}

/** Limiter guarding this app's public API routes, keyed by client identity. */
export const apiLimiter = new RateLimiter(
  Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
  Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60) / 60,
);

/** Conservative per-upstream limiter; providers share it by key. */
export const providerLimiter = new RateLimiter(30, 0.5);
