import type { PrismaClient } from '@prisma/client';

/**
 * Indexes Prisma's schema language cannot express. A TTL index lets MongoDB purge expired
 * refresh tokens automatically. Safe to run on every boot (createIndexes is idempotent).
 */
export async function ensureDatabaseIndexes(prisma: PrismaClient): Promise<void> {
  await prisma.$runCommandRaw({
    createIndexes: 'refresh_tokens',
    indexes: [
      { key: { expiresAt: 1 }, name: 'refresh_tokens_expiresAt_ttl', expireAfterSeconds: 0 },
    ],
  });
}
