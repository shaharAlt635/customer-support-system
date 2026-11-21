import { PERMISSIONS, customerListQuerySchema, updateCustomerSchema } from '@support-desk/shared';
import type { FastifyPluginAsync } from 'fastify';
import { parse, parseIdParam } from '../../lib/validation';

/** /api/customers — the company's customer accounts. */
export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authorize(PERMISSIONS.CUSTOMERS_MANAGE));

  app.get('/', async (request) => {
    const query = parse(customerListQuerySchema, request.query);
    return app.services.customers.list(request.user.companyId, query);
  });

  app.patch('/:id', async (request) => {
    const id = parseIdParam(request.params, 'Customer');
    const { isActive } = parse(updateCustomerSchema, request.body);
    return app.services.customers.setActive(request.user.companyId, id, isActive);
  });
};
