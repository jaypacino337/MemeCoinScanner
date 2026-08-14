import { NextResponse } from 'next/server';
import { credentialStatus, getEnv } from '@/env';
import { handle, serialize } from '@/server/api';
import { getHealthSnapshot } from '@/server/scan-service';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request, async () => {
    const env = getEnv();

    let databaseReachable = true;
    let databaseError: string | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      databaseReachable = false;
      databaseError = error instanceof Error ? error.message : String(error);
    }

    const sources = await getHealthSnapshot();

    return NextResponse.json(
      serialize({
        dataMode: env.DATA_MODE,
        linkVerificationEnabled: env.ENABLE_LINK_VERIFICATION,
        credentials: credentialStatus(),
        database: { reachable: databaseReachable, error: databaseError },
        sources,
      }),
    );
  });
}
