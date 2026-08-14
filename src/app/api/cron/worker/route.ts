import { NextResponse } from 'next/server';
import { authorizeCron, handle, serialize } from '@/server/api';
import { buildQueue } from '@/server/scan-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Drains the background job queue. Call this on a short interval (every minute
 * or two) from the same scheduler that hits /api/cron/scan.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    const unauthorized = authorizeCron(request);
    if (unauthorized) return unauthorized;

    const queue = buildQueue();
    const result = await queue.drain(5);
    const stats = await queue.stats();

    return NextResponse.json(serialize({ ...result, stats }));
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
