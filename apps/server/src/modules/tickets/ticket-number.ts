import type { PrismaClient } from '@prisma/client';
import { ejsonNumber, ejsonObjectId } from '../../lib/ejson';

/** Ticket numbers start at #1001 so they look established from day one. */
export const TICKET_NUMBER_OFFSET = 1000;
const COUNTER_NAME = 'ticket';

/**
 * Atomically reserve a company's next ticket number using MongoDB's `findAndModify` with
 * `$inc`, which is safe under concurrent requests (unlike a read-then-write).
 */
export async function nextTicketNumber(prisma: PrismaClient, companyId: string): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = (await prisma.$runCommandRaw({
        findAndModify: 'counters',
        query: { companyId: ejsonObjectId(companyId), name: COUNTER_NAME },
        update: { $inc: { seq: 1 } },
        new: true,
        upsert: true,
      })) as { value?: { seq?: unknown } };

      const seq = ejsonNumber(result.value?.seq);
      if (seq === null) throw new Error('Ticket counter returned an invalid value');
      return TICKET_NUMBER_OFFSET + seq;
    } catch (error) {
      // Two first-ever upserts can race on the unique index; the retry will find the doc.
      if (attempt < 3 && String(error).includes('E11000')) continue;
      throw error;
    }
  }
}

/** Ensure a company's counter is at least `lastNumber` (used by the seed script). */
export async function setTicketCounter(
  prisma: PrismaClient,
  companyId: string,
  lastNumber: number,
): Promise<void> {
  await prisma.$runCommandRaw({
    update: 'counters',
    updates: [
      {
        q: { companyId: ejsonObjectId(companyId), name: COUNTER_NAME },
        u: { $max: { seq: lastNumber - TICKET_NUMBER_OFFSET } },
        upsert: true,
      },
    ],
  });
}
