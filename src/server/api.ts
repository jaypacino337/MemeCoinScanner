import { NextResponse } from 'next/server';
import { getEnv } from '@/env';
import { apiLimiter } from '@/lib/infra/rate-limit';
import { childLogger } from '@/lib/infra/logger';

/** Shared helpers for the route handlers: rate limiting, auth, JSON shaping. */

const log = childLogger({ stage: 'api' });

export interface ApiError {
  error: string;
  detail?: string;
}

export function jsonError(status: number, error: string, detail?: string): NextResponse {
  return NextResponse.json<ApiError>({ error, ...(detail ? { detail } : {}) }, { status });
}

/** Identifies a caller for rate limiting without storing anything about them. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'local';
  return `${new URL(request.url).pathname}:${ip}`;
}

export function enforceRateLimit(request: Request, cost = 1): NextResponse | null {
  const result = apiLimiter.check(clientKey(request), cost);
  if (result.allowed) return null;

  log.warn({ path: new URL(request.url).pathname }, 'rate limit hit');
  return NextResponse.json<ApiError>(
    {
      error: 'Rate limit exceeded',
      detail: `Try again in ${Math.ceil(result.retryAfterMs / 1000)}s`,
    },
    {
      status: 429,
      headers: {
        'retry-after': String(Math.ceil(result.retryAfterMs / 1000)),
        'x-ratelimit-limit': String(result.limit),
        'x-ratelimit-remaining': '0',
      },
    },
  );
}

/** Guards the scheduled-ingestion endpoints with the shared cron secret. */
export function authorizeCron(request: Request): NextResponse | null {
  const env = getEnv();
  const header = request.headers.get('authorization');
  const provided = header?.replace(/^Bearer\s+/i, '') ?? new URL(request.url).searchParams.get('secret');

  if (!provided || provided !== env.CRON_SECRET) {
    return jsonError(401, 'Unauthorized', 'A valid CRON_SECRET is required');
  }
  return null;
}

/** Wraps a handler so unexpected failures return structured JSON, not HTML. */
export async function handle(
  request: Request,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message, path: new URL(request.url).pathname }, 'unhandled route error');
    return jsonError(500, 'Internal error', message);
  }
}

/**
 * JSON-safe serialisation. Dates become ISO strings and BigInt becomes a
 * number so responses never throw on serialisation.
 */
export function serialize<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, val: unknown) =>
      typeof val === 'bigint' ? Number(val) : val,
    ),
  );
}
