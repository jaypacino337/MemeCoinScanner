import type { PrismaClient } from '@prisma/client';
import type { CacheRecord, PersistentCacheStore } from '@/lib/infra/cache';
import type { JobRecord, JobStatus, JobStore } from '@/lib/infra/queue';

/** Prisma-backed implementations of the infra store interfaces. */

export class PrismaCacheStore implements PersistentCacheStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(key: string): Promise<CacheRecord | null> {
    const row = await this.prisma.cacheEntry.findUnique({ where: { key } });
    if (!row) return null;
    return { value: row.value, expiresAt: row.expiresAt };
  }

  async set(key: string, value: unknown, expiresAt: Date): Promise<void> {
    const json = value as never;
    await this.prisma.cacheEntry.upsert({
      where: { key },
      create: { key, value: json, expiresAt },
      update: { value: json, expiresAt },
    });
  }

  async delete(key: string): Promise<void> {
    await this.prisma.cacheEntry.deleteMany({ where: { key } });
  }

  async purgeExpired(now: Date): Promise<number> {
    const result = await this.prisma.cacheEntry.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}

export class PrismaJobStore implements JobStore {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueue(input: {
    queue: string;
    name: string;
    payload: unknown;
    runAt: Date;
    maxAttempts: number;
  }): Promise<JobRecord> {
    const row = await this.prisma.job.create({
      data: {
        queue: input.queue,
        name: input.name,
        payload: input.payload as never,
        runAt: input.runAt,
        maxAttempts: input.maxAttempts,
      },
    });
    return toJobRecord(row);
  }

  /**
   * Atomically claims the next due job. `SKIP LOCKED` lets multiple workers
   * drain the same queue without handing the same job to two of them.
   */
  async claimNext(queue: string, now: Date): Promise<JobRecord | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Job"
      SET status = 'RUNNING',
          attempts = attempts + 1,
          "startedAt" = ${now},
          "updatedAt" = ${now}
      WHERE id = (
        SELECT id FROM "Job"
        WHERE queue = ${queue}
          AND status = 'QUEUED'
          AND "runAt" <= ${now}
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `;

    const claimed = rows[0];
    if (!claimed) return null;

    const row = await this.prisma.job.findUnique({ where: { id: claimed.id } });
    return row ? toJobRecord(row) : null;
  }

  async complete(id: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: retryAt
        ? { status: 'QUEUED', runAt: retryAt, lastError: error }
        : { status: 'DEAD', lastError: error, finishedAt: new Date() },
    });
  }

  async countByStatus(queue: string): Promise<Record<JobStatus, number>> {
    const grouped = await this.prisma.job.groupBy({
      by: ['status'],
      where: { queue },
      _count: { _all: true },
    });
    const counts: Record<JobStatus, number> = {
      QUEUED: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const row of grouped) {
      counts[row.status as JobStatus] = row._count._all;
    }
    return counts;
  }
}

interface JobRow {
  id: string;
  queue: string;
  name: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
}

function toJobRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    queue: row.queue,
    name: row.name,
    payload: row.payload,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    lastError: row.lastError,
  };
}
