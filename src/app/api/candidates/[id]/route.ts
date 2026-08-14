import { NextResponse } from 'next/server';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { getCandidate } from '@/server/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const { id } = await context.params;
    const candidate = await getCandidate(id);
    if (!candidate) return jsonError(404, 'Candidate not found');

    return NextResponse.json(serialize({ candidate }));
  });
}
