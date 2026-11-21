import type { FastifyPluginAsync } from 'fastify';

/**
 * Development mailbox API. Only registered when EMAIL_TRANSPORT=dev outside production,
 * so it is never reachable on a real deployment.
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
    await app.prisma.devEmail.deleteMany();
    return reply.status(204).send();
  });
};
