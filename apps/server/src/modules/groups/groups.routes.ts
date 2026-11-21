import { PERMISSIONS, groupSchema, updateGroupSchema } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parse, parseIdParam } from '../../lib/validation';

/** /api/groups — permission groups. Readable by anyone who manages the team or groups. */
export const groupRoutes: FastifyPluginAsync = async (app) => {
  const manage = app.authorize(PERMISSIONS.GROUPS_MANAGE);

  app.get(
    '/',
    {
      preHandler: app.authorizeAny(
        PERMISSIONS.GROUPS_MANAGE,
        PERMISSIONS.TEAM_INVITE,
        PERMISSIONS.TEAM_MANAGE,
      ),
    },
    async (request) => ({ data: await app.services.groups.list(request.user.companyId) }),
  );

  app.post('/', { preHandler: manage }, async (request, reply) => {
    const input = parse(groupSchema, request.body);
    return reply.status(201).send(await app.services.groups.create(request.user.companyId, input));
  });

  app.patch('/:id', { preHandler: manage }, async (request) => {
    const id = parseIdParam(request.params, 'Permission group');
    const input = parse(updateGroupSchema, request.body);
    return app.services.groups.update(request.user.companyId, id, input);
  });

  app.delete('/:id', { preHandler: manage }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Permission group');
    await app.services.groups.remove(request.user.companyId, id);
    return reply.status(204).send();
  });
};
