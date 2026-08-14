import { NextResponse } from 'next/server';
import { authorizeCron, handle, serialize } from '@/server/api';
import { buildQueue } from '@/server/scan-service';

export const dynamic = 'force-dynamic';

/**
 * Scheduled ingestion trigger. Enqueues a scan rather than running it inline so
 * the request returns immediately and the work is retried on failure.
 *
 * Wire this to your scheduler (vercel.json crons, a systemd timer, k8s CronJob)
 * with the CRON_SECRET as a bearer token.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    const unauthorized = authorizeCron(request);
    if (unauthorized) return unauthorized;

    const queue = buildQueue();
    const primary = await queue.enqueue('scan', { windowDays: 7 });
    // Secondary early-signal sweep at a lower view floor.
    const early = await queue.enqueue('scan', { windowDays: 14, minViews: 500_000 });
    const purge = await queue.enqueue('purge-cache', {});

    return NextResponse.json(
      serialize({ enqueued: [primary.id, early.id, purge.id] }),
    );
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
