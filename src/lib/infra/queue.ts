/**
 * Database-backed background job queue.
 *
 * Deliberately dependency-free (no Redis) so the app runs with only Postgres.
 * Claiming uses `FOR UPDATE SKIP LOCKED` in the Prisma-backed store, so several
 * workers can share one queue safely.
 */

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';

export interface JobRecord {
  id: string;
  queue: string;
  name: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lastError: string | null;
}

export interface JobStore {
  enqueue(input: {
    queue: string;
    name: string;
    payload: unknown;
    runAt: Date;
    maxAttempts: number;
  }): Promise<JobRecord>;
  claimNext(queue: string, now: Date): Promise<JobRecord | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
  countByStatus(queue: string): Promise<Record<JobStatus, number>>;
}

export type JobHandler = (payload: unknown, job: JobRecord) => Promise<void>;

export interface WorkerOptions {
  queue: string;
  /** Base delay for exponential backoff between retries. */
  backoffMs?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private readonly queue: string;
  private readonly backoffMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: JobStore,
    options: WorkerOptions,
  ) {
    this.queue = options.queue;
    this.backoffMs = options.backoffMs ?? 2000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.now = options.now ?? (() => new Date());
  }

  register(name: string, handler: JobHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  async enqueue(name: string, payload: unknown, delayMs = 0): Promise<JobRecord> {
    if (!this.handlers.has(name)) {
      throw new Error(`No handler registered for job "${name}"`);
    }
    return this.store.enqueue({
      queue: this.queue,
      name,
      payload,
      runAt: new Date(this.now().getTime() + delayMs),
      maxAttempts: this.maxAttempts,
    });
  }

  /**
   * Processes up to `max` due jobs. Returns how many ran. Called by the
   * scheduled worker endpoint; safe to invoke concurrently.
   */
  async drain(max = 10): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < max; i += 1) {
      const job = await this.store.claimNext(this.queue, this.now());
      if (!job) break;

      const handler = this.handlers.get(job.name);
      if (!handler) {
        await this.store.fail(job.id, `No handler registered for "${job.name}"`, null);
        failed += 1;
        continue;
      }

      try {
        await handler(job.payload, job);
        await this.store.complete(job.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        // claimNext already incremented attempts to include this run, so
        // job.attempts is the number used — adding one would retire the job a
        // whole attempt early.
        const attemptsUsed = job.attempts;
        const retryAt =
          attemptsUsed >= job.maxAttempts
            ? null
            : new Date(this.now().getTime() + this.backoffMs * 2 ** (attemptsUsed - 1));
        await this.store.fail(job.id, message, retryAt);
      }
    }

    return { processed, failed };
  }

  stats(): Promise<Record<JobStatus, number>> {
    return this.store.countByStatus(this.queue);
  }
}

/** In-memory store — used by tests and by `npm run scan` in fixture mode. */
export class InMemoryJobStore implements JobStore {
  private jobs: JobRecord[] = [];
  private seq = 0;

  async enqueue(input: {
    queue: string;
    name: string;
    payload: unknown;
    runAt: Date;
    maxAttempts: number;
  }): Promise<JobRecord> {
    this.seq += 1;
    const job: JobRecord = {
      id: `job_${this.seq}`,
      queue: input.queue,
      name: input.name,
      payload: input.payload,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: input.maxAttempts,
      runAt: input.runAt,
      lastError: null,
    };
    this.jobs.push(job);
    return job;
  }

  async claimNext(queue: string, now: Date): Promise<JobRecord | null> {
    const job = this.jobs.find(
      (j) => j.queue === queue && j.status === 'QUEUED' && j.runAt.getTime() <= now.getTime(),
    );
    if (!job) return null;
    job.status = 'RUNNING';
    job.attempts += 1;
    return job;
  }

  async complete(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) job.status = 'SUCCEEDED';
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.lastError = error;
    if (retryAt) {
      job.status = 'QUEUED';
      job.runAt = retryAt;
    } else {
      job.status = 'DEAD';
    }
  }

  async countByStatus(queue: string): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      QUEUED: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const job of this.jobs) {
      if (job.queue === queue) counts[job.status] += 1;
    }
    return counts;
  }

  all(): JobRecord[] {
    return this.jobs;
  }
}
