import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Next.js dev-mode hot reload would otherwise open a new pool
 * on every recompile and exhaust Postgres connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** BigInt columns must be narrowed before they reach JSON or the client. */
export function bigIntToNumber(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function numberToBigInt(value: number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return BigInt(Math.round(value));
}
