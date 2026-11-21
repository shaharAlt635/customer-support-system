import type { FastifyPluginAsync } from 'fastify';

import { Errors } from '../../lib/errors';

/**
 * Development mailbox API. Only registered when EMAIL_TRANSPORT=dev outside production —
 * or on a public demo (DEMO_MODE), where it is how visitors read the app's emails.
 */
export const devRoutes: FastifyPluginAsync = async (app) => {
  app.get('/emails', async () => {
    const emails = await app.prisma.devEmail.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      data: emails.map((email) => ({ ...email, createdAt: email.createdAt.toISOString() })),
    };
  });

  app.delete('/emails', async (_request, reply) => {
    // A demo's mailbox is shared by every visitor; the daily reset empties it.
    if (app.config.DEMO_MODE) throw Errors.forbidden('The demo mailbox cannot be cleared');
    await app.prisma.devEmail.deleteMany();
    return reply.status(204).send();
  });
};
