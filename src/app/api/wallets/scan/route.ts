import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TRACKED_WALLETS } from '@/lib/domain/wallet';
import { analyzeWalletActivity } from '@/lib/pipeline/wallet-analysis';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { getRegistry } from '@/server/scan-service';

export const dynamic = 'force-dynamic';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const bodySchema = z.object({
  address: z.string().regex(BASE58, 'Not a valid Solana address'),
  /** UTC day to scan, YYYY-MM-DD. Defaults to today (UTC). */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ trackedWallets: TRACKED_WALLETS });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    // On-chain scans page through potentially hundreds of RPC calls.
    const limited = enforceRateLimit(request, 5);
    if (limited) return limited;

    const raw: unknown = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'Invalid request', parsed.error.issues[0]?.message);
    }

    const now = new Date();
    const day = parsed.data.date ?? now.toISOString().slice(0, 10);
    const windowStart = new Date(`${day}T00:00:00.000Z`);
    const windowEnd = new Date(`${day}T23:59:59.999Z`);
    if (Number.isNaN(windowStart.getTime())) {
      return jsonError(400, 'Invalid request', 'date must be a real calendar day');
    }
    if (windowStart > now) {
      return jsonError(400, 'Invalid request', 'date is in the future');
    }

    const registry = getRegistry();
    const batch = await registry.walletActivity.fetchSwaps(
      parsed.data.address,
      windowStart,
      windowEnd > now ? now : windowEnd,
    );
    const report = analyzeWalletActivity(batch, now);

    return NextResponse.json(
      serialize({
        provider: { name: registry.walletActivity.name, mode: registry.walletActivity.mode },
        report,
      }),
    );
  });
}
