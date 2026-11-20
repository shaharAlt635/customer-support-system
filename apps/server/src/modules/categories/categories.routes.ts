import {
  PERMISSIONS,
  categorySchema,
  hasPermission,
  updateCategorySchema,
} from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse, parseIdParam } from '../../lib/validation';

const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  const manageCategories = app.authorize(PERMISSIONS.CATEGORY_MANAGE);

  app.get('/', { preHandler: app.authenticate }, async (request) => {
    const { includeInactive } = parse(listQuerySchema, request.query);
    const canManage = hasPermission(request.user.role, PERMISSIONS.CATEGORY_MANAGE);
    return { data: await app.services.categories.list(includeInactive && canManage) };
  });

  app.post('/', { preHandler: manageCategories }, async (request, reply) => {
    const input = parse(categorySchema, request.body);
    return reply.status(201).send(await app.services.categories.create(input));
  });

  app.patch('/:id', { preHandler: manageCategories }, async (request) => {
    const id = parseIdParam(request.params, 'Category');
    const input = parse(updateCategorySchema, request.body);
    return app.services.categories.update(id, input);
  });

  app.delete('/:id', { preHandler: manageCategories }, async (request, reply) => {
    const id = parseIdParam(request.params, 'Category');
    await app.services.categories.remove(id);
    return reply.status(204).send();
  });
};
