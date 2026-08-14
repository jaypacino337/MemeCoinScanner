import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CONTENT_CATEGORIES, PLATFORMS } from '@/lib/domain/types';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { executeScan } from '@/server/scan-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
  windowDays: z.number().int().min(1).max(365).optional(),
  minViews: z.number().int().min(0).optional(),
  minLikes: z.number().int().min(0).optional(),
  minFollowers: z.number().int().min(0).optional(),
  categories: z.array(z.enum(CONTENT_CATEGORIES)).optional(),
  requireEnglishAudience: z.boolean().optional(),
  animalsOnly: z.boolean().optional(),
  catsAndDogsOnly: z.boolean().optional(),
  pfpFriendlyOnly: z.boolean().optional(),
  noCelebrityOrIpRisk: z.boolean().optional(),
  requireCleanPumpFun: z.boolean().optional(),
  signalStage: z.enum(['any', 'early', 'giga']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    // Scans are expensive; they cost more of the caller's budget than a read.
    const limited = enforceRateLimit(request, 10);
    if (limited) return limited;

    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return jsonError(400, 'Invalid scan filters', parsed.error.issues[0]?.message);
    }

    const { scanRunId, result, fixtureMode } = await executeScan(parsed.data, 'manual');

    return NextResponse.json(
      serialize({
        scanRunId,
        fixtureMode,
        stats: result.stats,
        errors: result.errors,
        accepted: result.candidates.length,
        rejected: result.rejected.length,
      }),
    );
  });
}
