import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CONTENT_CATEGORIES, PLATFORMS } from '@/lib/domain/types';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { getFeed } from '@/server/queries';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  category: z.enum(CONTENT_CATEGORIES).optional(),
  screeningStatus: z.enum(['CLEAN', 'DUST_ONLY', 'OCCUPIED', 'UNCERTAIN']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  minScore: z.coerce.number().min(0).max(100).optional(),
  savedOnly: z.coerce.boolean().optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      return jsonError(400, 'Invalid query parameters', parsed.error.issues[0]?.message);
    }

    const candidates = await getFeed(parsed.data);
    return NextResponse.json(
      serialize({
        count: candidates.length,
        requestedLimit: parsed.data.limit,
        candidates,
      }),
    );
  });
}
