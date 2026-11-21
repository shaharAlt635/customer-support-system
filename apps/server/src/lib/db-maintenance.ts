import type { PrismaClient } from '@prisma/client';

/**
 * Indexes Prisma's schema language cannot express. TTL indexes let MongoDB purge expired
 * tokens automatically. Safe to run on every boot (createIndexes is idempotent).
 */
export async function ensureDatabaseIndexes(prisma: PrismaClient): Promise<void> {
  const ttl = (collection: string, field: string, expireAfterSeconds: number) =>
    prisma.$runCommandRaw({
      createIndexes: collection,
      indexes: [{ key: { [field]: 1 }, name: `${collection}_${field}_ttl`, expireAfterSeconds }],
    });

  await Promise.all([
    // Expired sessions and email links are removed automatically.
    ttl('refresh_tokens', 'expiresAt', 0),
    ttl('user_tokens', 'expiresAt', 0),
    // The development mailbox only keeps a week of emails.
    ttl('dev_emails', 'createdAt', 7 * 24 * 60 * 60),
  ]);
}
