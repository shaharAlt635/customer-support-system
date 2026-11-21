import type { FastifyPluginAsync } from 'fastify';
import { parseIdParam } from '../../lib/validation';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => app.services.notifications.list(request.user.id));

  app.post('/read-all', async (request, reply) => {
    await app.services.notifications.markAllRead(request.user.id);
    return reply.status(204).send();
  });

  app.post('/:id/read', async (request, reply) => {
    const id = parseIdParam(request.params, 'Notification');
    await app.services.notifications.markRead(request.user.id, id);
    return reply.status(204).send();
  });
};
