import { NextResponse } from 'next/server';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { getCandidate } from '@/server/queries';
import { rescanCandidate } from '@/server/scan-service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request, 5);
    if (limited) return limited;

    const { id } = await context.params;
    const result = await rescanCandidate(id);
    if (!result.ok) return jsonError(409, 'Rescan failed', result.message);

    const candidate = await getCandidate(id);
    return NextResponse.json(serialize({ ok: true, message: result.message, candidate }));
  });
}
