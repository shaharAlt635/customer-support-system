import {
  PERMISSIONS,
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parse, parseIdParam } from '../../lib/validation';

export const userRoutes: FastifyPluginAsync = async (app) => {
  const manageUsers = app.authorize(PERMISSIONS.USER_MANAGE);

  app.get('/', { preHandler: manageUsers }, async (request) => {
    const query = parse(userListQuerySchema, request.query);
    return app.services.users.list(query);
  });

  /** Staff that tickets can be assigned to — available to anyone who can assign. */
  app.get('/assignable', { preHandler: app.authorize(PERMISSIONS.TICKET_ASSIGN) }, async () => ({
    data: await app.services.users.listAssignable(),
  }));

  app.post('/', { preHandler: manageUsers }, async (request, reply) => {
    const input = parse(createUserSchema, request.body);
    return reply.status(201).send(await app.services.users.create(input));
  });

  app.patch('/:id', { preHandler: manageUsers }, async (request) => {
    const id = parseIdParam(request.params, 'User');
    const input = parse(updateUserSchema, request.body);
    return app.services.users.update(request.user, id, input);
  });
};
