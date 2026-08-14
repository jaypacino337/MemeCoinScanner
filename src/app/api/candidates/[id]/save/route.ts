import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, handle, jsonError, serialize } from '@/server/api';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ note: z.string().max(500).optional() });

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
    const note = parsed.success ? parsed.data.note ?? null : null;

    const saved = await prisma.savedIdea.upsert({
      where: { candidateId: id },
      create: { candidateId: id, note },
      update: { note },
    });

    // Saving an idea clears any prior rejection: the two states are exclusive.
    await prisma.rejection.deleteMany({ where: { candidateId: id } });

    return NextResponse.json(serialize({ saved: true, id: saved.id }));
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
    await prisma.savedIdea.deleteMany({ where: { candidateId: id } });
    return NextResponse.json(serialize({ saved: false }));
  });
}
