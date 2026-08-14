import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ reason: z.string().min(1).max(500).default('Marked weak by user') });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request, 2);
    if (limited) return limited;

    const { id } = await context.params;
    const exists = await prisma.viralCandidate.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return jsonError(404, 'Candidate not found');

    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    const reason = parsed.success ? parsed.data.reason : 'Marked weak by user';

    await prisma.rejection.upsert({
      where: { candidateId: id },
      create: { candidateId: id, reason, origin: 'user' },
      update: { reason, origin: 'user' },
    });
    await prisma.savedIdea.deleteMany({ where: { candidateId: id } });

    return NextResponse.json(serialize({ rejected: true, reason }));
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handle(request, async () => {
    const limited = enforceRateLimit(request, 2);
    if (limited) return limited;

    const { id } = await context.params;
    await prisma.rejection.deleteMany({ where: { candidateId: id } });
    return NextResponse.json(serialize({ rejected: false }));
  });
}
