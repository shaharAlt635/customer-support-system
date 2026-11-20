import { statsQuerySchema } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validation';

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/overview', { preHandler: app.authenticate }, async (request) => {
    const { days } = parse(statsQuerySchema, request.query);
    return app.services.stats.overview(request.user, days);
  });
};
