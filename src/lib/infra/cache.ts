/**
 * Two-tier response cache.
 *
 * Tier 1 is an in-process LRU-ish map (fast, per-instance). Tier 2 is the
 * CacheEntry table, so a scheduled job and a web request share upstream
 * responses instead of each burning rate-limit budget.
 *
 * The store is injected so unit tests never touch Postgres.
 */

export interface CacheRecord {
  value: unknown;
  expiresAt: Date;
}

export interface PersistentCacheStore {
  get(key: string): Promise<CacheRecord | null>;
  set(key: string, value: unknown, expiresAt: Date): Promise<void>;
  delete(key: string): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

const MAX_MEMORY_ENTRIES = 500;

export class Cache {
  private memory = new Map<string, CacheRecord>();

  constructor(
    private readonly store: PersistentCacheStore | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const local = this.memory.get(key);
    if (local) {
      if (local.expiresAt.getTime() > this.now().getTime()) {
        // Refresh recency for the crude LRU eviction below.
        this.memory.delete(key);
        this.memory.set(key, local);
        return local.value as T;
      }
      this.memory.delete(key);
    }

    if (!this.store) return null;
    const remote = await this.store.get(key);
    if (!remote) return null;
    if (remote.expiresAt.getTime() <= this.now().getTime()) {
      await this.store.delete(key);
      return null;
    }
    this.writeMemory(key, remote);
    return remote.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1000);
    this.writeMemory(key, { value, expiresAt });
    if (this.store) await this.store.set(key, value, expiresAt);
  }

  /** Cache-aside helper: returns the cached value or computes and stores it. */
  async wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await compute();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async invalidate(key: string): Promise<void> {
    this.memory.delete(key);
    if (this.store) await this.store.delete(key);
  }

  clearMemory(): void {
    this.memory.clear();
  }

  private writeMemory(key: string, record: CacheRecord): void {
    if (this.memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next();
      if (!oldest.done) this.memory.delete(oldest.value);
    }
    this.memory.set(key, record);
  }
}

export const memoryCache = new Cache();

export function cacheKey(parts: Array<string | number | undefined | null>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join(':');
}
